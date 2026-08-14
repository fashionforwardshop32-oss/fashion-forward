-- supabase/migrations/20260814000002_finalize_order.sql

-- SCOPE — READ BEFORE ADDING A CALLER.
--
-- This function is valid ONLY for the single payment-confirming transition:
--   pending_payment -> confirmed   (Razorpay verify / webhook)
--   cod_pending     -> confirmed   (COD order placement)
--
-- The stock decrement below is UNCONDITIONAL. It runs on whatever transition
-- it is handed, guarded only by the p_from_status check — it is NOT keyed to
-- "payment confirmation" in any way. So a plausible-looking future call such as
-- finalize_order(id, 'confirmed', 'packed') for an admin status-update feature
-- would silently decrement stock a SECOND time for an order that already paid
-- for it. The from-status guard makes the function idempotent for a *repeat of
-- the same transition pair* (the second call no-ops and returns false); it does
-- nothing to protect a *different* transition pair.
--
-- Any future caller wanting a non-payment-confirming transition (packed,
-- out_for_delivery, delivered, cancelled, returned, rto) must NOT reuse this
-- function without first re-auditing the decrement logic — most of those
-- transitions need no stock movement at all, and cancelled/returned/rto need
-- an INCREMENT, not a decrement.

create or replace function finalize_order(
  p_order_id uuid,
  p_from_status text,
  p_to_status text
)
returns boolean
language plpgsql
as $$
declare
  v_locked_status text;
  v_item record;
begin
  -- Row lock on the order serializes concurrent callers for the SAME
  -- order (e.g. Razorpay's client callback and webhook firing near-
  -- simultaneously for one payment) — the second caller blocks here
  -- until the first commits, then sees the status check below fail
  -- and safely no-ops.
  select status into v_locked_status from orders where id = p_order_id for update;

  if v_locked_status is null then
    raise exception 'order_not_found';
  end if;

  if v_locked_status <> p_from_status then
    return false;
  end if;

  -- ORDER BY is load-bearing, not cosmetic. Each UPDATE below takes a row lock
  -- on a variant and holds it until this transaction commits. Two multi-item
  -- orders sharing variants but visiting them in different orders would each
  -- hold one lock and wait on the other's — a classic deadlock, which Postgres
  -- resolves by aborting one transaction with SQLSTATE 40P01, NOT with
  -- 'insufficient_stock'. Callers branch on 'insufficient_stock' /
  -- 'order_not_found', so a 40P01 would fall through as an unhandled error —
  -- possibly after Razorpay already captured the payment. Locking every
  -- variant in the same global order (by primary key) makes the cycle, and so
  -- the deadlock, structurally impossible.
  for v_item in
    select oi.variant_id, oi.qty
    from order_items oi
    where oi.order_id = p_order_id
    order by oi.variant_id
  loop
    -- The WHERE clause is the actual race-safety mechanism: this UPDATE
    -- only matches a row if there's still enough stock, and Postgres
    -- serializes concurrent UPDATEs to the same row. A losing concurrent
    -- transaction (for a DIFFERENT order competing for the same variant)
    -- gets zero rows affected here, which FOUND below detects, which
    -- raises, which rolls back this entire function's transaction —
    -- including any earlier item decrements in the same order and the
    -- status update that would otherwise follow. All-or-nothing.
    update variants
    set stock_qty = stock_qty - v_item.qty
    where id = v_item.variant_id and stock_qty >= v_item.qty;

    if not found then
      raise exception 'insufficient_stock';
    end if;
  end loop;

  update orders set status = p_to_status where id = p_order_id;
  return true;
end;
$$;
