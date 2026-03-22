import fs from "fs"
import path from "path"
import type { HashCache } from "./scanFiles"

export async function saveHashCache(
  cachePath: string,
  data: HashCache
): Promise<void> {
  await fs.promises.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.promises.writeFile(
    cachePath,
    JSON.stringify(data, null, 2),
    "utf8"
  )
}