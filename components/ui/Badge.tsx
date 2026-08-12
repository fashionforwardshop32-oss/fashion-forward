type BadgeProps = {
  tone?: "accent" | "highlight" | "brand";
  className?: string;
  children: React.ReactNode;
};

const toneClasses: Record<NonNullable<BadgeProps["tone"]>, string> = {
  accent: "bg-accent text-on-accent",
  highlight: "bg-highlight text-ink",
  brand: "bg-brand text-on-brand",
};

export function Badge({ tone = "accent", className = "", children }: BadgeProps) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-body font-semibold ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
