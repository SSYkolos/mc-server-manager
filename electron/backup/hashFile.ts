import crypto from "crypto"
import fs from "fs"

async function hashWithAlgorithm(
  filePath: string,
  algorithm: "sha1" | "sha256"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm)
    const stream = fs.createReadStream(filePath)

    stream.on("data", (data) => hash.update(data))
    stream.on("end", () => resolve(hash.digest("hex")))
    stream.on("error", reject)
  })
}

export function hashFileFast(filePath: string): Promise<string> {
  return hashWithAlgorithm(filePath, "sha1")
}

export function hashFileStrong(filePath: string): Promise<string> {
  return hashWithAlgorithm(filePath, "sha256")
}

// backward compatibility
export function hashFile(filePath: string): Promise<string> {
  return hashFileStrong(filePath)
}