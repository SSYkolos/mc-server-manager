import fs from "fs";
import path from "path";
import archiver from "archiver";

export async function zipDirectory(sourceDir: string, outPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(sourceDir)) {
      return resolve(false); // Folder doesn't exist (e.g. no plugins folder yet)
    }

    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 5 } }); // Level 5 is a good speed/size balance

    output.on("close", () => resolve(true));
    
    // THE FIX: Added ': any' to the err parameter
    archive.on("error", (err: any) => {
      console.error(`[Zip] Failed to zip ${sourceDir}:`, err);
      resolve(false);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false); // 'false' puts contents at the root of the zip
    archive.finalize();
  });
}