
// createBackupZip.ts
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { BACKUP_PATHS } from "./backupWhitelist";

export async function createBackupZip(
  serverPath: string,
  outZipPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outZipPath);
    const archive = archiver("zip", { zlib: { level: 6 } }); // gyors

    output.on("close", resolve);
    archive.on("error", reject);

    archive.pipe(output);

    for (const p of BACKUP_PATHS) {
      const full = path.join(serverPath, p);
      if (!fs.existsSync(full)) continue;

      if (fs.statSync(full).isDirectory()) {
        archive.directory(full, p);
      } else {
        archive.file(full, { name: p });
      }
    }

    archive.finalize();
  });
}
