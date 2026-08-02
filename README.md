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

Design approved. Implementation not yet started.
