-- supabase/migrations/20260803000003_customers_grant_fix.sql
--
-- Narrow the customers UPDATE grant to client-editable columns only.
--
-- 20260803000002_rls.sql granted table-wide UPDATE on customers to
-- `authenticated`. RLS scopes *rows* (id = auth.uid()), never *columns*, so an
-- authenticated customer could PATCH any column on their own row.
--
-- customers columns: id, phone, name, email, created_at
--   id         -- primary key, FK to auth.users(id); identity, never client-writable
--   phone      -- identity linkage for phone-OTP auth; a client rewriting this
--                 could desync it from auth.users.phone or squat another number
--   created_at -- system-owned audit timestamp
--   name       -- legitimate customer-editable profile field
--   email      -- legitimate customer-editable profile field
--
-- The row-level policy "customer updates own row" still applies on top of this;
-- column grants are a second, independent layer, not a replacement.

revoke update on table customers from authenticated;
grant update (name, email) on table customers to authenticated;
