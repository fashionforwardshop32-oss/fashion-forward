import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-tint">
      <header className="border-b border-ink/10 bg-surface px-4 py-3">
        <span className="font-display text-lg font-bold text-brand">Fashion Forward Admin</span>
      </header>
      <div className="p-4">{children}</div>
    </div>
  );
}
