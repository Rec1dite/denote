import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Writes only when the content differs, so Rollup's watcher doesn't loop on generated modules.
export function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  writeFileSync(path, content);
  return true;
}
