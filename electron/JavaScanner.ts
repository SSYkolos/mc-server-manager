import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// Cache the found Java versions so we only scan the hard drive ONCE per app launch
let javaCache: Record<number, string> = {};

// Maps Minecraft versions to required Java versions
function getRequiredJavaMajorVersion(mcVersion: string): number {
  if (!mcVersion) return 21; // Fallback

  try {
    // 1. Normalize the string by removing any "1." prefix if it exists
    // "1.26.2" becomes "26.2". "26.2" remains "26.2".
    let normalized = mcVersion.trim();
    if (normalized.startsWith("1.")) {
      normalized = normalized.substring(2);
    }

    // 2. Extract the main version number (the minor version in MC terms)
    const match = normalized.match(/^(\d+)/);
    
    if (!match) {
      console.warn(`[Java Scanner] Furcsa MC verzió kapva: "${mcVersion}". Feltételezzük, hogy modern (Java 25).`);
      return 25; // Default to the latest Java if we can't parse it
    }

    const minor = parseInt(match[1], 10);

    // 3. Map to the correct Java version
    if (minor <= 12) return 8;  // 1.12.2 and older
    if (minor <= 16) return 11; // 1.16.5
    if (minor === 17) return 16;// 1.17.1
    if (minor <= 20) return 17; // 1.18 - 1.20.4
    if (minor <= 24) return 21; // 1.20.5 - 1.24.x
    return 25;                  // 1.25+ and 1.26.x (The present day!)
    
  } catch (e) {
    console.error(`[Java Scanner] Failed to parse mcVersion "${mcVersion}"`, e);
    return 25;
  }
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