import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/Badge";
import { toggleProductStatus } from "./actions";

export default async function AdminProductsPage() {
  await requireAdmin();

  const supabase = createServerClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, title, base_price, status")
    .order("created_at", { ascending: false });

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">Products</h1>
        <Link href="/admin/products/new" className="text-sm font-semibold text-brand">
          + Add product
        </Link>
      </div>

      <div className="space-y-2">
        {(products ?? []).map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-card border border-ink/10 bg-surface p-3"
          >
            <div>
              <Link href={`/admin/products/${p.id}/edit`} className="font-medium text-ink">
                {p.title}
              </Link>
              <div className="text-sm text-ink-muted">₹{p.base_price}</div>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={p.status === "active" ? "brand" : "accent"}>{p.status}</Badge>
              <form
                action={async () => {
                  "use server";
                  await toggleProductStatus(p.id, p.status);
                }}
              >
                <button type="submit" className="text-sm font-medium text-brand">
                  {p.status === "active" ? "Archive" : "Activate"}
                </button>
              </form>
            </div>
          </div>
        ))}
        {(!products || products.length === 0) && (
          <p className="text-sm text-ink-muted">No products yet.</p>
        )}
      </div>
    </main>
  );
}
