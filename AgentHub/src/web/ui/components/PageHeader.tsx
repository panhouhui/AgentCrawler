import React from "react";

interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: React.ReactNode;
  readonly count?: number;
  readonly actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, count, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8 max-sm:flex-col max-sm:gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h2 className="m-0 text-2xl font-bold text-strong tracking-tight">
            {title}
          </h2>
          {count !== undefined && (
            <span className="font-mono text-sm font-medium text-muted bg-bg-2 px-2.5 py-1 rounded-md">
              {count}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-base text-muted mt-1.5 m-0">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0 max-sm:w-full">{actions}</div>}
    </div>
  );
}
