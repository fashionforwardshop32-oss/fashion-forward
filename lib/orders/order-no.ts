import { createServerClient } from "@/lib/supabase/server";

export async function generateOrderNo(
  supabase: ReturnType<typeof createServerClient>,
): Promise<string> {
  while (true) {
    const candidate = `FF${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;

    const { data, error } = await supabase
      .from("orders")
      .select("id")
      .eq("order_no", candidate)
      .maybeSingle();

    if (error) throw new Error(`generateOrderNo: ${error.message}`);
    if (!data) return candidate;
  }
}
