export type LargeObject = {
  hash: string
  size: number
  path: string
}

export async function prepareLargeObjects(
  files: { absolute: string; size: number; hash: string }[]
): Promise<LargeObject[]> {
  return files.map((f) => ({
    hash: f.hash,
    size: f.size,
    path: f.absolute
  }))
}