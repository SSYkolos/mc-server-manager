import fs from "fs"
import path from "path"
import archiver from "archiver"
import { ScannedFile } from "./scanFiles"
import { hashFile } from "./hashFile"

const MAX_PACK_SIZE = 32 * 1024 * 1024

export type BuiltSmallPackEntry = {
  path: string
  size: number
  hash: string
}

export type BuiltSmallPack = {
  packPath: string
  packHash: string
  fileName: string
  entries: BuiltSmallPackEntry[]
}

export async function buildSmallPacks(
  files: ScannedFile[],
  tempDir: string
): Promise<BuiltSmallPack[]> {
  const packs: BuiltSmallPack[] = []

  let currentPack: ScannedFile[] = []
  let currentSize = 0
  let packIndex = 0

  for (const file of files) {
    if (currentPack.length > 0 && currentSize + file.size > MAX_PACK_SIZE) {
      packs.push(await createPack(currentPack, tempDir, packIndex))
      currentPack = []
      currentSize = 0
      packIndex++
    }

    currentPack.push(file)
    currentSize += file.size
  }

  if (currentPack.length > 0) {
    packs.push(await createPack(currentPack, tempDir, packIndex))
  }

  return packs
}

async function createPack(
  files: ScannedFile[],
  tempDir: string,
  index: number
): Promise<BuiltSmallPack> {
  const tempPackPath = path.join(tempDir, `pack-temp-${index}.zip`)

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(tempPackPath)
    const archive = archiver("zip", {
      zlib: { level: 0 }
    })

    output.on("close", resolve)
    output.on("error", reject)
    archive.on("error", reject)

    archive.pipe(output)

    for (const f of files) {
      archive.file(f.absolute, { name: f.path })
    }

    archive.finalize()
  })

  const packHash = await hashFile(tempPackPath)
  const fileName = `pack-${packHash}.zip`
  const finalPackPath = path.join(tempDir, fileName)

  if (!fs.existsSync(finalPackPath)) {
    fs.renameSync(tempPackPath, finalPackPath)
  } else {
    fs.unlinkSync(tempPackPath)
  }

  return {
    packPath: finalPackPath,
    packHash,
    fileName,
    entries: files.map((f) => ({
      path: f.path,
      size: f.size,
      hash: f.hash
    }))
  }
}