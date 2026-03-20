export function getWorkerCount(fileCount: number) {
  if (fileCount <= 0) return 2
  if (fileCount < 6) return 4
  if (fileCount < 18) return 6
  return 8
}