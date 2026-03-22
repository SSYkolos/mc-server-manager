import fs from "fs"
import path from "path"

export type SnapshotManifestFile =
  | {
      path: string
      size: number
      hash: string
      storage: "large-object"
      objectFileId: string
      objectName: string
    }
  | {
      path: string
      size: number
      hash: string
      storage: "small-pack"
      packHash: string
      packFileId: string
      packFileName: string
    }

export function createSnapshotManifest({
  snapshotId,
  serverId,
  files,
  snapshotDir
}: {
  snapshotId: string
  serverId: string
  files: SnapshotManifestFile[]
  snapshotDir: string
}) {
  const manifest = {
    snapshotId,
    serverId,
    createdAt: new Date().toISOString(),
    files
  }

  const manifestPath = path.join(snapshotDir, "manifest.json")

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2),
    "utf-8"
  )

  return manifestPath
}