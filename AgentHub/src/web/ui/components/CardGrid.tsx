import React from "react";

interface CardGridProps {
  readonly minWidth?: string;
  readonly gap?: string;
  readonly children: React.ReactNode;
}

export function CardGrid({ minWidth = "360px", gap, children }: CardGridProps) {
  return (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${minWidth}, 100%), 1fr))`,
        ...(gap !== undefined ? { gap } : {}),
      }}
    >
      {children}
    </div>
  );
}
