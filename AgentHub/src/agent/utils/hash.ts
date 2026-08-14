import { createHash } from "crypto";

export function hashTask(task: string): string {
  return createHash("sha256").update(task).digest("hex").slice(0, 16);
}
