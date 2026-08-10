type BadgeProps = {
  tone?: "accent" | "highlight" | "brand";
  children: React.ReactNode;
};

const toneClasses: Record<NonNullable<BadgeProps["tone"]>, string> = {
  accent: "bg-accent text-white",
  highlight: "bg-highlight text-ink",
  brand: "bg-brand text-white",
};

export function Badge({ tone = "accent", children }: BadgeProps) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-body font-semibold ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
