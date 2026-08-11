# Fashion Forward

Ecommerce store for Fashion Forward — children's clothing, RT Nagar, Bangalore.

## Stack

- **App** — Next.js 15 (App Router, TypeScript)
- **Host** — Cloudflare Workers via `@opennextjs/cloudflare`
- **Database / Auth / Storage** — Supabase (ap-south-1, Mumbai)
- **Payments** — Razorpay (UPI, card, netbanking) + Cash on Delivery
- **Delivery** — Porter, behind a pluggable `ShippingProvider` interface
- **Styling** — Tailwind v4 with semantic theme tokens

## Design

The full design document lives at
[`docs/superpowers/specs/2026-08-03-fashion-forward-ecommerce-design.md`](docs/superpowers/specs/2026-08-03-fashion-forward-ecommerce-design.md).

Read it before making architectural changes.

## Status

Week 1 (foundation) is built and deployed. Live at
<https://fashion-forward.fashion-forward.workers.dev>.

In place:

- Next.js 15 App Router scaffold, deployed to Cloudflare Workers through
  `@opennextjs/cloudflare` + Wrangler
- Supabase project linked (ap-south-1, Mumbai), 11 tables across three
  migrations, all applied locally and on remote
- Row level security policies, covered by `tests/rls.test.ts`
- Tailwind v4 semantic theme tokens and the base UI kit (`Button`, `Badge`,
  `Card`, `PriceTag`), previewable at `/style-guide`

Not built yet: catalog and product pages, cart and checkout, Razorpay
payments, Porter delivery, admin. Those are Week 2 onward — see the plan at
[`docs/superpowers/plans/2026-08-03-week1-foundation.md`](docs/superpowers/plans/2026-08-03-week1-foundation.md).

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
```

`.env.local` takes `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
and `SUPABASE_SERVICE_ROLE_KEY` from the Supabase dashboard
(Project Settings → API). Copy the same three into `.dev.vars`, which is what
the local Workers runtime reads during `npm run cf:preview`. Both files are
gitignored — never commit either.

Start the local Supabase stack (needs Docker running):

```bash
npx supabase start
```

> If this fails with `LegacyNetworkCreateError`, run `docker network prune -f`
> and try again.

Sync migrations to the remote Mumbai project:

```bash
npx supabase db push
```

Then run the app:

```bash
npm run dev
```

## Commands

| Command | Notes |
| --- | --- |
| `npm run dev` | Next.js dev server on <http://localhost:3000>. |
| `npm run build` | Production Next.js build. |
| `npm test` | Vitest. The RLS suite needs local Supabase running plus `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` exported from `npx supabase status`; without them it skips cleanly and the run still passes. It refuses to run against any non-loopback `SUPABASE_URL`, so it can never write into the production database. |
| `npm run lint` | ESLint flat config extending `next/core-web-vitals` and `next/typescript`. |
| `npm run cf:preview` | Builds and serves the Worker locally, reading `.dev.vars`. |
| `npm run cf:deploy` | Builds and deploys to Cloudflare Workers. |

### Deploy notes

- `NEXT_PUBLIC_*` vars are inlined into the bundle **at build time**, so
  `.env.local` must be present and populated when `npm run cf:deploy` runs.
  Deploying without it ships a build that cannot reach Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` is a runtime secret and must never go in
  `wrangler.jsonc` — that file is committed. Set it on the deployed Worker
  with:

  ```bash
  npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
  ```

  Nothing consumes it yet; it becomes required once Week 2 adds server-side
  admin code (`lib/supabase/server.ts`).
