import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PriceTag } from "@/components/ui/PriceTag";

export default function StyleGuidePage() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="font-display text-3xl font-bold text-ink">Style Guide</h1>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ink">Buttons</h2>
        <div className="flex gap-3">
          <Button variant="primary">Add to Cart</Button>
          <Button variant="secondary">View Details</Button>
          <Button variant="primary" disabled>
            Sold Out
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ink">Badges</h2>
        <div className="flex gap-3">
          <Badge tone="accent">Sale</Badge>
          <Badge tone="highlight">New</Badge>
          <Badge tone="brand">Bestseller</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ink">Card + Price</h2>
        <Card className="max-w-xs p-4">
          <div className="mb-3 h-40 rounded-card bg-tint" />
          <p className="font-body text-ink">Floral Cotton Frock, 4Y</p>
          <PriceTag price={899} originalPrice={1199} />
        </Card>
      </section>
    </main>
  );
}
