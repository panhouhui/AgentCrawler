import { readFileSync } from "node:fs";
import path from "node:path";

export const LOGO = `
   ___                   ____
  / _ \\ _ __   ___ _ __ / ___|_ __ _____      __
 | | | | '_ \\ / _ \\ '_ \\ |   | '__/ _ \\ \\ /\\ / /
 | |_| | |_) |  __/ | | | |___| | | (_) \\ V  V /
  \\___/| .__/ \\___|_| |_|\\____|_|  \\___/ \\_/\\_/
       |_|
`;

export function getVersion(): string {
  try {
    const pkgPath = path.resolve(import.meta.dir, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function getAppDir(): string {
  return path.resolve(import.meta.dir, "..", "..");
}
