import fs from "fs";
import path from "path";
import archiver from "archiver";


const INCLUDE = [
  "world",
  "world_nether",
  "world_the_end",
  "server.properties",
  "ops.json",
  "whitelist.json",
  "banned-players.json",
  "banned-ips.json",
  "usercache.json",
  "permissions.yml",
  "eula.txt",
  "spigot.yml",
  "paper.yml",
  "bukkit.yml"
];

export async function createSnapshot(
  serverPath: string,
  zipPath: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(archive.pointer()));
    archive.on("error", reject);

    archive.pipe(output);

    for (const item of INCLUDE) {
      const full = path.join(serverPath, item);
      if (!fs.existsSync(full)) continue;

      if (fs.lstatSync(full).isDirectory()) {
        archive.directory(full, item);
      } else {
        archive.file(full, { name: item });
      }
    }

    archive.finalize();
  });
}
