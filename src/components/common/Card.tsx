import type { ReactNode } from "react";

export default function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-bg-card border border-border rounded-xl p-4 ${className}`}>
      {children}
    </div>
  );
}
