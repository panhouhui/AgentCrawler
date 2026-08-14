import React from "react";
import type { FieldError } from "react-hook-form";
import { cn } from "../lib/cn";

interface FormFieldProps {
  readonly label?: string;
  readonly id?: string;
  readonly error?: FieldError;
  readonly hint?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * Wrapper that adds label, error message, and hint to any form control.
 * Works with react-hook-form's FieldError type.
 */
export function FormField({ label, id, error, hint, children, className }: FormFieldProps) {
  return (
    <div className={className}>
      {label && (
        <label
          className="block text-sm font-semibold text-muted uppercase tracking-wide mb-2"
          htmlFor={id}
        >
          {label}
        </label>
      )}
      {children}
      {error?.message && (
        <p className={cn("text-danger text-xs mt-1")}>{error.message}</p>
      )}
      {hint && !error?.message && (
        <p className="text-faint text-xs mt-1">{hint}</p>
      )}
    </div>
  );
}
