import { useForm } from "react-hook-form";
import type { UseFormProps, UseFormReturn, FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

/**
 * Thin wrapper around react-hook-form's useForm that wires up zod validation.
 */
export function useZodForm<T extends FieldValues>(
  schema: z.ZodType<T>,
  props?: Omit<UseFormProps<T>, "resolver">,
): UseFormReturn<T> {
  return useForm<T>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    ...props,
  });
}
