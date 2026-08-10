-- supabase/migrations/20260803000001_schema.sql

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  parent_id uuid references categories(id) on delete set null,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  category_id uuid references categories(id) on delete set null,
  gender text not null check (gender in ('boy', 'girl', 'unisex')),
  age_group text not null,
  base_price numeric(10, 2) not null check (base_price >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now()
);
create index products_category_id_idx on products(category_id);
create index products_status_idx on products(status);

create table variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  size text not null,
  color text,
  sku text not null unique,
  price_override numeric(10, 2) check (price_override >= 0),
  stock_qty integer not null default 0 check (stock_qty >= 0),
  created_at timestamptz not null default now(),
  unique (product_id, size, color)
);
create index variants_product_id_idx on variants(product_id);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  url_400 text not null,
  url_800 text not null,
  url_1600 text not null,
  alt text,
  position integer not null default 0
);
create index product_images_product_id_idx on product_images(product_id);

create table customers (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique,
  name text,
  email text,
  created_at timestamptz not null default now()
);

create table addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  line1 text not null,
  line2 text,
  landmark text,
  city text not null default 'Bangalore',
  pincode text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index addresses_customer_id_idx on addresses(customer_id);

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  customer_id uuid not null references customers(id),
  status text not null default 'pending_payment' check (status in (
    'pending_payment', 'cod_pending', 'confirmed', 'packed',
    'out_for_delivery', 'delivered', 'cancelled', 'returned', 'rto'
  )),
  payment_mode text not null check (payment_mode in ('razorpay', 'cod')),
  subtotal numeric(10, 2) not null,
  shipping_fee numeric(10, 2) not null default 0,
  discount numeric(10, 2) not null default 0,
  total numeric(10, 2) not null,
  address_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index orders_customer_id_idx on orders(customer_id);
create index orders_status_idx on orders(status);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  variant_id uuid not null references variants(id),
  qty integer not null check (qty > 0),
  unit_price numeric(10, 2) not null,
  title_snapshot text not null
);
create index order_items_order_id_idx on order_items(order_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  razorpay_order_id text,
  razorpay_payment_id text unique,
  amount numeric(10, 2) not null,
  status text not null check (status in ('created', 'captured', 'failed', 'refunded')),
  created_at timestamptz not null default now()
);
create index payments_order_id_idx on payments(order_id);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null default 'porter',
  external_ref text,
  tracking_url text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index shipments_order_id_idx on shipments(order_id);

create table coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type text not null check (type in ('percent', 'flat')),
  value numeric(10, 2) not null check (value > 0),
  min_cart numeric(10, 2) not null default 0,
  expires_at timestamptz,
  usage_limit integer,
  created_at timestamptz not null default now()
);
