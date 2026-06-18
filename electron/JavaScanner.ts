import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// Cache the found Java versions so we only scan the hard drive ONCE per app launch
let javaCache: Record<number, string> = {};

// Maps Minecraft versions to required Java versions
function getRequiredJavaMajorVersion(mcVersion: string): number {
  if (!mcVersion) return 17; // Fallback

  const parts = mcVersion.split(".");
  const minor = parseInt(parts[1], 10);
  const patch = parts.length > 2 ? parseInt(parts[2], 10) : 0;

  if (minor <= 12) return 8;  // 1.12.2 and older -> Java 8
  if (minor <= 16) return 11; // 1.16.5 -> Java 11
  if (minor === 17) return 16;// 1.17.1 -> Java 16
  if (minor < 20 || (minor === 20 && patch < 5)) return 17; // 1.18 to 1.20.4 -> Java 17
  return 21; // 1.20.5+ -> Java 21
}

function scanForJava(): Record<number, string> {
  // Common installation paths on Windows. (Can add Mac/Linux paths here later)
  const searchPaths = [
    "C:\\Program Files\\Java",
    "C:\\Program Files (x86)\\Java",
    "C:\\Program Files\\Eclipse Adoptium",
    "C:\\Program Files\\BellSoft"
  ];

  const foundJavas: Record<number, string> = {};

  for (const basePath of searchPaths) {
    if (!fs.existsSync(basePath)) continue;

    const folders = fs.readdirSync(basePath);
    for (const folder of folders) {
      const javaExe = path.join(basePath, folder, "bin", "java.exe");
      
      if (fs.existsSync(javaExe)) {
        try {
          // 'java -version' prints to stderr, so we redirect it 2>&1
          const output = execSync(`"${javaExe}" -version 2>&1`, { encoding: "utf8" });
          
          // Extracts the version number (e.g., "1.8.0_202" or "17.0.2")
          const match = output.match(/version "([^"]+)"/);
          if (match) {
            const versionStr = match[1];
            let major = 0;
            
            if (versionStr.startsWith("1.")) {
              major = parseInt(versionStr.split(".")[1], 10); // "1.8" -> 8
            } else {
              major = parseInt(versionStr.split(".")[0], 10); // "17.0" -> 17
            }

            // Save the path if we haven't found this major version yet
            if (!foundJavas[major]) {
              foundJavas[major] = javaExe;
            }
          }
        } catch (e) {
          // Ignore files that fail to execute
        }
      }
    }
  }
  return foundJavas;
}

export function resolveJavaExecutable(mcVersion: string): string {
  const requiredMajor = getRequiredJavaMajorVersion(mcVersion);

  // If cache is empty, scan the system
  if (Object.keys(javaCache).length === 0) {
    javaCache = scanForJava();
    console.log("[Java Scanner] Found Java versions mapped:", javaCache);
  }

  // If we found the exact required version, return it
  if (javaCache[requiredMajor]) {
    console.log(`[Java Scanner] Selected Java ${requiredMajor} for MC ${mcVersion}`);
    return javaCache[requiredMajor];
  }

  // If not found, log a warning and fallback to system default
  console.warn(`[Java Scanner] WARNING: Could not find Java ${requiredMajor} for MC ${mcVersion}. Falling back to system default "java". This might crash!`);
  return "java";
}