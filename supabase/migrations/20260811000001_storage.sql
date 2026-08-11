insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "public read product images"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');

-- No insert/update/delete policy for anon/authenticated: only the
-- service role (which bypasses RLS) writes to this bucket, from admin
-- Server Actions. Matches the products/variants pattern from Week 1.
