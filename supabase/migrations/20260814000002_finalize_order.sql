-- supabase/migrations/20260814000002_finalize_order.sql

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

  for v_item in
    select oi.variant_id, oi.qty
    from order_items oi
    where oi.order_id = p_order_id
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
