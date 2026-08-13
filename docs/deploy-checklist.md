# Deploy checklist

Things that must be done or checked by hand against the **deployed Worker**,
because no test, type check, lint rule or build step catches them.

## Not yet verified in real production: the image resize pipeline

**Status: unverified against real production conditions.**

The upload-time image pipeline (`lib/images/photon.ts` → `lib/images/upload.ts`,
which resizes each uploaded photo to 400/800/1600px WebP before storing it in
Supabase Storage) has been proven in three places, none of which is the real
thing:

| Where | What it proves | What it doesn't |
| --- | --- | --- |
| `next dev` | The resize logic is correct. | Runs on Node, not workerd — a different photon build, no Worker limits. |
| `npm run cf:preview` | It runs under workerd. | Local workerd does not enforce the real CPU-time or memory limits. |
| Deployed Worker, 300px test image | The workerd build loads and executes on the live host. | A deliberately tiny image — nowhere near the CPU/memory a real photo costs. |

So the one case that actually matters — **a full-size photo straight off a
phone camera (3–12MP, several MB), decoded and resized three times inside the
live Worker's real resource limits** — has never been run.

### Action item

Blocked on: an admin Supabase Auth user existing whose email is in
`ADMIN_EMAILS` on the deployed Worker. (Creating that user is a separate task —
noted here only because this check can't happen before it.)

Once that user exists:

1. Log in at `/admin/login` on the deployed Worker.
2. Create a product at `/admin/products/new`, attaching **one real,
   unresized photo taken on a phone**.
3. Confirm the upload completes without a 500 and the product saves.
4. Open the product's row in `product_images` and request all three URLs
   (`url_400`, `url_800`, `url_1600`). Each must return
   **`200`** with **`content-type: image/webp`**.

```bash
for u in "$URL_400" "$URL_800" "$URL_1600"; do
  curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "$u"
done
```

If any of these fails — most likely as a Worker CPU-time limit or an
out-of-memory error rather than a clean error message — the pipeline needs a
size cap on accepted uploads (or a move to client-side downscaling before
upload) before the client is handed the admin.

Delete the test product afterwards.

## After any dependency bump touching the photon runtime

`vendor/photon-runtime/` is a load-bearing workaround whose failure mode is a
runtime 500 on the live Worker only — every local check passes. Before trusting
the image pipeline after a version bump of `next`, `@opennextjs/cloudflare` or
`@cf-wasm/photon`, re-run the manual verification described in
[`vendor/photon-runtime/README.md`](../vendor/photon-runtime/README.md).
