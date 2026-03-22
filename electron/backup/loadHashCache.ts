import fs from "fs"
import type { HashCache } from "./scanFiles"

export async function loadHashCache(cachePath: string): Promise<HashCache> {
  try {
    if (!fs.existsSync(cachePath)) return {}

    const raw = await fs.promises.readFile(cachePath, "utf8")
    if (!raw.trim()) return {}

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}