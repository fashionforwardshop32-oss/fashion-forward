# Fashion Forward — Ecommerce Site Design

**Date:** 2026-08-03
**Client:** Fashion Forward, children's clothing retailer, RT Nagar, Bangalore
**Status:** Approved design, pre-implementation

---

## 1. Goal

Ship a live ecommerce store in 4–6 weeks that takes real orders and real money, and that the shop owner can operate from her phone without developer help.

**Success criteria**

1. Customer can browse, pick a size, pay by UPI/card or choose COD, and receive the order.
2. Owner can add a product, see a new order, and fulfil it — entirely on mobile, without training beyond a 10-minute walkthrough.
3. Running cost is ₹0/month excluding domain and per-transaction gateway fees.
4. Store handles 10–50 orders/day without redesign.

**Non-goals for v1:** wishlists, reviews, loyalty points, blog, multi-language, gift wrap, back-in-stock alerts, self-service returns portal.

---

## 2. Context and constraints

| Fact | Value |
|---|---|
| Catalog size | Under 150 SKUs |
| Delivery | Bangalore only, via Porter; pluggable for other providers later |
| Payments | Razorpay (UPI/card/netbanking) + Cash on Delivery |
| Owner tech comfort | Low — phone-first, WhatsApp-native |
| Client assets ready | GST + current account, product photos, product list, domain, Instagram |
| Timeline | 4–6 weeks to live |
| Traffic expectation | Low at launch; design for 10–50 orders/day |

GST and current account already exist, so Razorpay live-mode KYC is not a launch blocker.

---

## 3. Architecture

Single Next.js 15 application (App Router, TypeScript). Not split into separate frontend and backend services — server rendering is required for product SEO, and one deployable is one thing to maintain.

```
app/
  (shop)/           storefront, public, SSR/ISR
  (admin)/          owner dashboard, auth-gated
  api/              webhooks and mutations
lib/
  db/               Supabase queries, one module per entity
  payments/         Razorpay: create order, verify, webhook
  shipping/         ShippingProvider interface + PorterProvider
  notify/           WhatsApp and email dispatch
  images/           upload-time WebP generation
```

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| App | Next.js 15 App Router, TypeScript | SSR for product SEO; Server Actions reduce boilerplate |
| Host | Cloudflare Workers via `@opennextjs/cloudflare` | Runs at Bangalore edge; unlimited bandwidth; free tier permits commercial use |
| DB | Supabase Postgres, ap-south-1 (Mumbai) | Low latency to Cloudflare's India edge; data stays in India |
| Auth | Supabase Auth, phone OTP | Indian shoppers are phone-first, not email-first |
| Storage | Supabase Storage | Product images |
| Payments | Razorpay Standard Checkout | Existing team familiarity |
| Styling | Tailwind v4, semantic theme tokens | Palette must be swappable late in the project |
| Email | Resend free tier | Secondary channel, paper trail |
| Messaging | Meta WhatsApp Cloud API | Primary customer channel in India |

### Hosting decision

Netlify was evaluated and rejected. Netlify Functions run in `cmh` (Ohio) on free and Starter plans; custom regions require Pro, and Mumbai is not offered on any self-serve plan. With a Mumbai database that path costs roughly 900ms per dynamic request. Cloudflare Workers execute at the Bangalore edge adjacent to Supabase Mumbai, giving roughly 70ms.

Accepted cost of this choice: the OpenNext adapter is less mature than Netlify's official Next.js runtime, and `next/image` is not usable. Both are mitigated below.

### Key boundary: shipping

```ts
interface ShippingProvider {
  quote(cart: Cart, address: Address): Promise<Quote>;
  book(order: Order): Promise<Shipment>;
  track(ref: string): Promise<TrackingStatus>;
}
```

`PorterProvider` ships first, in **manual mode**: the owner taps "Book Porter", the app opens Porter with pickup and drop prefilled, and she pastes the tracking link back. API mode is a config flag, enabled once Porter approves the business account. Adding Shiprocket, Delhivery, or in-house delivery agents later means one new file implementing this interface — no changes elsewhere.

### Image pipeline

Cloudflare Workers cannot run the `next/image` optimizer, and Cloudflare Images costs money. Images are therefore optimized at **upload time**, not request time:

```
owner uploads photo in admin
  → server generates 3 WebP sizes: 400px, 800px, 1600px
  → all three written to Supabase Storage
  → storefront serves plain <img srcset>, CDN-cached
```

Zero runtime cost, host-portable, and faster than on-the-fly optimization. 150 SKUs × 4 photos × 3 sizes ≈ 1,800 files, roughly 400MB — within the Supabase free tier.

### Trust boundary

Price and stock are never accepted from the client. The browser cart stores only `{variantId, qty}`. The server re-prices on every cart read and again at checkout. The Razorpay order amount is computed server-side, then verified by HMAC on both the return callback and the webhook.

---

## 4. Data model

```
products        id, slug, title, description, category_id, gender,
                age_group, base_price, status, created_at
variants        id, product_id, size, color, sku, price_override, stock_qty
product_images  id, product_id, url_400, url_800, url_1600, alt, position
categories      id, slug, name, parent_id

customers       id (Supabase auth uid), phone, name, email
addresses       id, customer_id, line1, line2, landmark, city,
                pincode, is_default

orders          id, order_no, customer_id, status, payment_mode,
                subtotal, shipping_fee, discount, total,
                address_snapshot (jsonb), created_at
order_items     id, order_id, variant_id, qty, unit_price, title_snapshot
payments        id, order_id, razorpay_order_id, razorpay_payment_id,
                amount, status
shipments       id, order_id, provider, external_ref, tracking_url, status
coupons         id, code, type, value, min_cart, expires_at, usage_limit
```

### Decisions worth stating

**Stock lives on `variants`, not `products`.** "Frock, size 4Y, red" is the unit that sells out. Product-level stock is wrong from day one and painful to migrate later.

**Orders store snapshots.** `address_snapshot`, `unit_price`, and `title_snapshot` are frozen copies taken at purchase time. When the owner renames a product or raises a price months later, historical orders and invoices must not change.

**Row Level Security on every table.** Customers read only their own orders and addresses. The admin role bypasses. Policies are written alongside the schema, not retrofitted.

### Order status machine

```
pending_payment ──┐
                  ├→ confirmed → packed → out_for_delivery → delivered
cod_pending ──────┘
        │
        └→ cancelled / returned / rto   (reachable from any prior state)
```

All transitions go through a single function that validates the source state. Status is never updated by scattered writes, and the owner never selects a status from a free dropdown — she taps buttons that map to legal transitions only.

---

## 5. Storefront

Mobile-first throughout; assume 85%+ of traffic is phone.

| Route | Render | Notes |
|---|---|---|
| `/` | ISR | Hero, categories, new arrivals, offers |
| `/c/[category]` | ISR + client-side filters | Filter by age, size, gender, price. At ~150 SKUs no search infrastructure is needed |
| `/p/[slug]` | ISR | Gallery, variant picker, size chart, add to cart |
| `/cart` | Client | Server re-prices on load |
| `/checkout` | Server | Address → delivery → payment |
| `/orders`, `/orders/[id]` | Server, auth | Status timeline, tracking link |
| `/account` | Server, auth | Addresses, phone, order history |

### Purchase flow

```
PDP → select size (out-of-stock sizes shown greyed, never hidden)
    → add to cart (localStorage: variantId + qty only)
    → cart: server re-prices and revalidates stock
    → checkout:
        1. phone OTP via Supabase Auth
        2. address form; pincode checked against Bangalore allowlist
           → outside zone: message + WhatsApp contact link
        3. payment: Razorpay or COD
    → order created (pending_payment or cod_pending)
    → confirmation page + WhatsApp message
```

### Three deliberate choices

**No signup wall.** Phone OTP happens inside checkout and doubles as account creation. Signup gates are the single largest conversion loss on Indian mobile commerce.

**Size chart is a first-class feature.** Most children's clothing returns are sizing errors. Every PDP carries an age-to-height/chest table plus a "runs small / true to size" note. This is the cheapest available reduction in return rate.

**Pincode serviceability is checked before payment.** Taking money and then cancelling is the worst possible first experience.

---

## 6. Admin

The owner is phone-first with low tech comfort. Admin is a mobile web app opened from a home-screen shortcut, not a desktop dashboard. Five screens, no more.

1. **Orders** — default screen. Card list, newest first, large status chips.
2. **Order detail** — customer, items, address, Call and WhatsApp buttons, and exactly one primary action button reflecting current state: `Confirm` → `Mark Packed` → `Book Porter` → `Mark Delivered`.
3. **Products** — list with an in-stock toggle; edit price and per-size stock.
4. **Add product** — six fields maximum: photos, title, category, age range, price, sizes with stock.
5. **Coupons** — code, percentage or rupee value, expiry.

### Notifications

| Event | Customer | Owner |
|---|---|---|
| Order placed | WhatsApp confirmation | WhatsApp alert |
| Payment failed | WhatsApp retry link | — |
| Packed / out for delivery | WhatsApp + tracking link | — |
| Delivered | WhatsApp | — |
| COD collected | — | Reconciliation reminder |

WhatsApp uses Meta Cloud API with pre-approved templates. Email via Resend is secondary.

### COD safety rails

- Configurable COD cap, default ₹3,000
- COD unavailable on a first order above the cap
- Phone OTP must be verified before a COD order is accepted
- Admin shows running totals of COD collected versus COD pending

---

## 7. Payments and fulfilment

### Razorpay flow

```
checkout → POST /api/orders/create
         → server prices cart, creates order (pending_payment)
         → creates Razorpay order, returns id
         → Razorpay Checkout modal
         → success → POST /api/payments/verify → HMAC check → order = paid
         → webhook /api/payments/webhook (raw body, HMAC) → fallback if callback lost
```

Stock decrements on transition to `paid` or `cod_pending`, not on add-to-cart. No reservation timers — unnecessary at this volume.

### COD flow

Phone OTP already verified → order created as `cod_pending` → owner confirms → rider collects cash → owner marks `delivered` and `cash_collected`.

### Failure handling

| Failure | Behaviour |
|---|---|
| Payment fails | Order stays `pending_payment`, cart intact, retry link sent via WhatsApp |
| Webhook and callback both fire | Idempotent via unique constraint on `razorpay_payment_id` |
| Two buyers, last unit | Stock decrement runs inside a Postgres transaction with a stock check; loser sees "just sold out" and is auto-refunded if already charged |
| Porter unavailable | Order remains `packed`; owner calls the customer |

---

## 8. Visual design

Brand direction is purple-and-white, adapted from the client's existing preference, but deliberately warmed for a children's clothing context. A cool purple-on-white SaaS palette reads sterile against children's apparel, and a saturated purple competes with product photography.

| Role | Token | Value | Usage |
|---|---|---|---|
| Primary | `--color-brand` | `#7C3AED` | Nav, CTAs, active states, footer |
| Accent | `--color-accent` | `#FF7A59` | Sale badges, "New", hover states |
| Highlight | `--color-highlight` | `#FFC93C` | Offers, sparingly |
| Surface | `--color-surface` | `#FFFFFF` | All product cards and PDP backgrounds |
| Tint | `--color-tint` | `#F5F3FF` | Section bands only, never behind a product |
| Text | `--color-ink` | `#1F1B2E` | Body copy |
| Radius | `--radius-card` | `20px` | Cards, buttons, inputs |

Headings use a rounded display face (Fredoka or Baloo); body uses Inter or DM Sans.

**Tokenization is a hard requirement.** No component may contain a hardcoded hex value or literal Tailwind colour class. Components reference `bg-brand`, never `bg-purple-600`. This makes a full palette change a six-line edit — the client will want to iterate on colour, and that iteration must stay cheap.

---

## 9. Infrastructure and cost

| Piece | Service | Monthly cost |
|---|---|---|
| Hosting | Cloudflare Workers | ₹0 |
| Database, auth, storage | Supabase free, Mumbai | ₹0 |
| Images | Pre-generated WebP in Supabase Storage | ₹0 |
| Email | Resend free | ₹0 |
| WhatsApp | Meta Cloud API | ~₹100 |
| DNS | Cloudflare | ₹0 |
| Domain | Client-owned | — |

Per-transaction: Razorpay charges 2% plus 18% GST, roughly 2.36% of each prepaid order. COD carries no gateway fee. Porter charges per trip, passed to the customer as a shipping fee.

Deliberately not built: Redis caching, job queues, hosted search, read replicas, custom CDN configuration. All are premature at this volume and are added only when a measured number demands them.

---

## 10. Testing

| Layer | Approach |
|---|---|
| Pricing and cart | Unit tests — the money path is tested first and hardest |
| Order state machine | Unit tests covering every legal and illegal transition |
| Razorpay verify and webhook | Unit tests with recorded payloads; HMAC verified against known-good signatures |
| Stock decrement race | Integration test issuing concurrent purchases of the last unit |
| RLS policies | Integration tests asserting one customer cannot read another's orders |
| Checkout flow | One end-to-end happy path per payment mode, run before each deploy |

Manual pre-launch checklist: Razorpay live-mode test transaction with a real card and a real refund; COD order end to end; WhatsApp template delivery to a real number; admin walkthrough on the owner's own phone.

---

## 11. Delivery plan

| Week | Deliverable |
|---|---|
| 1 | Repo, Cloudflare deploy pipeline proven end to end, Supabase schema and RLS, theme tokens, design system |
| 2 | Catalog: PDP, category pages, filters, image pipeline, admin product create and edit |
| 3 | Cart, phone OTP auth, address capture, pincode gate, checkout UI |
| 4 | Razorpay integration, COD, order state machine, webhooks, stock decrements |
| 5 | Admin orders screen, Porter manual booking, WhatsApp notifications |
| 6 | Real product data entry, SEO, testing, soft launch |

Weeks 1–4 carry the risk. Week 6 is deliberately reserved as slack.

**Week 1, day 1 is the Cloudflare deployment pipeline.** A hello-world Next.js app must deploy to Cloudflare Workers before any feature work begins. If the OpenNext adapter holds a nasty surprise, it must surface while pivoting is still cheap — not in week five against a launch date.

---

## 12. Open items

| Item | Owner | Needed by |
|---|---|---|
| GitHub repo access on the `fashionforwardshop32-oss` account | Client / Tejas | Week 1 |
| Porter business account approval (unblocks API mode) | Client | Week 5, manual mode works meanwhile |
| Meta WhatsApp Business API approval and template review | Tejas | Week 5 |
| Razorpay live-mode KYC submission | Client | Week 4 |
| Bangalore pincode serviceability list | Client | Week 3 |
| Final palette sign-off from client | Client | Week 2, cheap to change later |
