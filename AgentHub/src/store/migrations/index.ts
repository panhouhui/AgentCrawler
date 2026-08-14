import { readdirSync, readFileSync } from "fs"
import { join } from "path"

const dir = import.meta.dir

function parseSqlStatements(content: string): string[] {
  const statements: string[] = []
  let current = ""
  let inDollarBlock = false

  for (const line of content.split("\n")) {
    current += (current ? "\n" : "") + line

    if (!inDollarBlock && line.includes("DO $$")) {
      inDollarBlock = true
    }

    if (inDollarBlock && line.includes("END $$")) {
      inDollarBlock = false
      statements.push(current.replace(/;\s*$/, "").trim())
      current = ""
      continue
    }

    if (!inDollarBlock && current.trimEnd().endsWith(";")) {
      const stmt = current.replace(/;\s*$/, "").trim()
      if (stmt) statements.push(stmt)
      current = ""
    }
  }

  const remaining = current.trim().replace(/;\s*$/, "").trim()
  if (remaining) statements.push(remaining)

  return statements
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()

export const MIGRATIONS: string[] = files.flatMap((f) => {
  const content = readFileSync(join(dir, f), "utf-8")
  return parseSqlStatements(content)
})
