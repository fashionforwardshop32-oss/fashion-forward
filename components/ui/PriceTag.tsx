type PriceTagProps = {
  price: number;
  originalPrice?: number;
};

/** Single source of ₹ formatting -- import this rather than writing `₹{n}`. */
export const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export function PriceTag({ price, originalPrice }: PriceTagProps) {
  return (
    <div className="flex items-baseline gap-2 font-body">
      <span className="text-lg font-semibold text-ink">{formatInr(price)}</span>
      {originalPrice ? (
        <span className="text-sm text-ink-muted line-through">
          {formatInr(originalPrice)}
        </span>
      ) : null}
    </div>
  );
}
