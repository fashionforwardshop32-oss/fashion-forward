type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-card bg-surface shadow-sm ${className}`}>
      {children}
    </div>
  );
}
