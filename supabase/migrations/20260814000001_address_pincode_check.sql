-- supabase/migrations/20260814000001_address_pincode_check.sql
--
-- Database-level backstop for the Bangalore-only delivery zone.
--
-- The gate (/^560\d{3}$/) has so far lived only in AddressStep.tsx's form
-- logic. RLS lets any authenticated customer insert their own addresses
-- rows, so someone holding their own valid session JWT could POST straight
-- at the Supabase REST API and store an out-of-zone address, never touching
-- the UI. Nothing is exploitable today — delivery zone is a business rule,
-- not a security boundary, and no order can be placed against an address
-- yet — but Week 4 builds order creation on top of these rows, so the
-- cheapest time to make the rule true at the source is before that lands.
--
-- Matches the UI regex exactly: '560' followed by three digits, anchored at
-- both ends so no leading/trailing junk slips past. `city` is left alone;
-- it already defaults to 'Bangalore' and the pincode is the real constraint.

alter table addresses
  add constraint addresses_pincode_bangalore_check
  check (pincode ~ '^560\d{3}$');
