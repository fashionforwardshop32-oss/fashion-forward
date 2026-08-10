-- supabase/migrations/20260803000002_rls.sql

alter table categories enable row level security;
alter table products enable row level security;
alter table variants enable row level security;
alter table product_images enable row level security;
alter table customers enable row level security;
alter table addresses enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table shipments enable row level security;
alter table coupons enable row level security;

-- Public catalog browsing (no auth required)

create policy "public read categories" on categories
  for select to anon, authenticated
  using (true);

create policy "public read active products" on products
  for select to anon, authenticated
  using (status = 'active');

create policy "public read variants of active products" on variants
  for select to anon, authenticated
  using (
    exists (
      select 1 from products p
      where p.id = variants.product_id and p.status = 'active'
    )
  );

create policy "public read images of active products" on product_images
  for select to anon, authenticated
  using (
    exists (
      select 1 from products p
      where p.id = product_images.product_id and p.status = 'active'
    )
  );

-- Customer self-service (requires auth.uid() = customers.id)

create policy "customer reads own row" on customers
  for select to authenticated
  using (id = auth.uid());

create policy "customer updates own row" on customers
  for update to authenticated
  using (id = auth.uid());

create policy "customer manages own addresses" on addresses
  for all to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

create policy "customer reads own orders" on orders
  for select to authenticated
  using (customer_id = auth.uid());

create policy "customer reads own order items" on order_items
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id and o.customer_id = auth.uid()
    )
  );

create policy "customer reads own shipments" on shipments
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.id = shipments.order_id and o.customer_id = auth.uid()
    )
  );

-- payments and coupons: no client-facing policies. RLS is enabled with
-- zero policies, which blocks anon/authenticated entirely; only the
-- service role (used server-side) can read or write these tables.

-- Table privileges.
--
-- RLS decides which rows a role may touch; GRANT decides whether the role may
-- touch the table at all. Tables created by a migration are owned by `postgres`,
-- and the public-schema default privileges belong to `supabase_admin`, so these
-- tables start with no DML grants for anon/authenticated/service_role (they do
-- inherit a stray TRUNCATE/TRIGGER/REFERENCES, which RLS does not restrain).
-- Reset both roles to zero and grant back exactly what the policies above need.

revoke all on table
  categories, products, variants, product_images, customers, addresses,
  orders, order_items, payments, shipments, coupons
  from anon, authenticated;

-- Server-side admin path. service_role bypasses RLS by role attribute, but
-- still needs table grants to reach the tables through PostgREST.
grant select, insert, update, delete on table
  categories, products, variants, product_images, customers, addresses,
  orders, order_items, payments, shipments, coupons
  to service_role;

-- Public catalog browsing.
grant select on table categories, products, variants, product_images
  to anon, authenticated;

-- Customer self-service, narrowed row-by-row by the policies above.
grant select, update on table customers to authenticated;
grant select, insert, update, delete on table addresses to authenticated;
grant select on table orders, order_items, shipments to authenticated;

-- payments and coupons stay revoked for anon and authenticated.
