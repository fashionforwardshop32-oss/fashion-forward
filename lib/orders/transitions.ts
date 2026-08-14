export type OrderStatus =
  | "pending_payment"
  | "cod_pending"
  | "confirmed"
  | "packed"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "returned"
  | "rto";

// True dead-ends only: zero legal outgoing edges. "delivered" is deliberately
// excluded — it has exactly one legal successor (returned), encoded below in
// LEGAL_TRANSITIONS, so it must fall through to the table lookup instead of
// being short-circuited here.
const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "cancelled",
  "returned",
  "rto",
]);

/**
 * The legal transition graph, matching spec §4 exactly:
 *
 *   pending_payment ─┐
 *   cod_pending ──────┼─→ confirmed → packed → out_for_delivery → delivered
 *                     │       │           │            │              │
 *                     └───────┴───────────┴────────────┘              │
 *                          (cancelled, from any pre-delivery state)   │
 *                                                                      ├─→ returned
 *                                              out_for_delivery ───────┘
 *                                              out_for_delivery ──────────→ rto
 */
const LEGAL_TRANSITIONS: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  pending_payment: new Set(["confirmed", "cancelled"]),
  cod_pending: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["packed", "cancelled"]),
  packed: new Set(["out_for_delivery", "cancelled"]),
  out_for_delivery: new Set(["delivered", "cancelled", "rto"]),
  delivered: new Set(["returned"]),
  cancelled: new Set([]),
  returned: new Set([]),
  rto: new Set([]),
};

export function isLegalTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  if (TERMINAL_STATUSES.has(from)) return false;
  return LEGAL_TRANSITIONS[from].has(to);
}
