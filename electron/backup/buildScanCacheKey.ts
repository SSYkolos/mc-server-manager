export function buildScanCacheKey(size: number, mtimeMs: number) {
  return `${size}:${Math.floor(mtimeMs)}`
}