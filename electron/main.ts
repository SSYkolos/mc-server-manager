import { createSnapshot } from "./backup";
import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from "fs";
import { google } from "googleapis";
import fetch, { Headers, Request, Response } from 'node-fetch';
import unzipper from "unzipper";
import { unlink } from "fs/promises";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as ini from "ini";
import { getValidAccessToken } from "./getValidAccessToken";
import { ensureDriveFolderPath } from "./driveFolderManager";
import { createAndUploadServerZip } from "./createServerZipAndUpload";
import { createBackupZip } from "./createBackupZip";
import { uploadResumableToDrive } from "./driveResumableUpload";
import os from "os";
import { createDriveClient } from "./googleAuth";
import http from "http";
import { randomBytes } from "crypto";
import open from "open";
import type { AddressInfo } from "net";
import net from "net";
import { pathToFileURL } from "url";
import { backupServerV2 } from "./backup/backupServerV2";
import { restoreSnapshotV2 } from "./backup/restoreSnapshotV2"
import { ensureBackupStructure } from './backup/ensureBackupStructure'

import { listSnapshotFolders } from "./backup/listSnapshotFolders";
import { deleteSnapshotFolders } from "./backup/deleteSnapshotFolders";
import { collectReferencedStoreFiles } from "./backup/collectReferencedStoreFiles";
import { garbageCollectBackupStore } from "./backup/garbageCollectBackupStore";



let client_id: string;
let client_secret: string;

const pidusage = require("pidusage");
const natUpnp = require("nat-upnp");
const upnpClient = natUpnp.createClient();

let upnpAvailability: "unknown" | "available" | "unavailable" = "unknown";

app.whenReady().then(() => {
  const oauthPath = app.isPackaged
    ? path.join(process.resourcesPath, "google-oauth.json") // ✅ release
    : path.join(app.getAppPath(), "google-oauth.json");     // ✅ dev

  if (!fs.existsSync(oauthPath)) {
    dialog.showErrorBox(
      "google-oauth.json missing",
      `Cannot find google-oauth.json at:\n${oauthPath}`
    );
    app.quit();
    return;
  }

  const oauthConfig = JSON.parse(fs.readFileSync(oauthPath, "utf8"));

  client_id = oauthConfig.installed.client_id;
  client_secret = oauthConfig.installed.client_secret;

  oauth2Client = new google.auth.OAuth2(client_id, client_secret);

  createWindow();
});


let oauth2Client: any; // keep it simple, avoids TS pain


async function authenticateWithGoogle(): Promise<any> {
  if (!oauth2Client) throw new Error("OAuth client not initialized yet.");

  return new Promise((resolve, reject) => {
    let localPort = 0;

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", `http://127.0.0.1:${localPort}`);

        const code = url.searchParams.get("code");
        const oauthError = url.searchParams.get("error");

        if (oauthError) {
          res.end("Auth failed. You can close this window and return to the app.");
          server.close();
          reject(new Error(String(oauthError)));
          return;
        }

        if (!code) {
          res.end("Waiting for Google auth...");
          return;
        }

        res.end("Drive linked successfully. You can close this window.");
        server.close();

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        resolve(tokens);
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      localPort = address.port;

      const redirectUri = `http://127.0.0.1:${localPort}`;
      oauth2Client.redirectUri = redirectUri;

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/drive.file",
        ],
        prompt: "consent",
      });

      open(authUrl).catch(reject);
    });
  });
}

async function findChildFolderId(
  drive: any,
  parentId: string,
  folderName: string
): Promise<string | null> {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 10,
  });

  return res.data.files?.[0]?.id ?? null;
}

async function getOrCreateChildFolderId(
  drive: any,
  parentId: string,
  folderName: string
): Promise<string> {
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 10,
  });

  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  if (!created.data.id) {
    throw new Error(`Failed to create Drive folder: ${folderName}`);
  }

  return created.data.id;
}


async function downloadDriveFileToPath(args: {
  drive: any;
  fileId: string;
  targetPath: string;
}) {
  const { drive, fileId, targetPath } = args;

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

  const streamRes = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(targetPath);

    out.on("finish", () => resolve());
    out.on("error", reject);
    streamRes.data.on("error", reject);

    streamRes.data.pipe(out);
  });
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
) {
  const queue = [...items];

  const workers = Array.from(
    { length: Math.min(limit, queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) return;
        await worker(item);
      }
    }
  );

  await Promise.all(workers);
}

async function downloadDriveFolderRecursive(args: {
  drive: any;
  folderId: string;
  localDestination: string;
}) {
  const { drive, folderId, localDestination } = args;

  await fs.promises.mkdir(localDestination, { recursive: true });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id, name, mimeType)",
    pageSize: 1000,
  });

  const files = res.data.files ?? [];

  const folders = files.filter(
    (file: any) => file.mimeType === "application/vnd.google-apps.folder"
  );

  const normalFiles = files.filter(
    (file: any) => file.mimeType !== "application/vnd.google-apps.folder"
  );

  await runWithConcurrency(normalFiles, 4, async (file: any) => {
    const targetPath = path.join(localDestination, file.name!);

    await downloadDriveFileToPath({
      drive,
      fileId: file.id!,
      targetPath,
    });
  });

  for (const folder of folders) {
    const targetPath = path.join(localDestination, folder.name!);

    await downloadDriveFolderRecursive({
      drive,
      folderId: folder.id!,
      localDestination: targetPath,
    });
  }
}

async function findChildFolderByName(
  drive: any,
  parentId: string,
  folderName: string
): Promise<{ id: string; name: string } | null> {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 10,
  });

  const found = res.data.files?.[0];
  if (!found?.id || !found?.name) return null;

  return {
    id: found.id,
    name: found.name,
  };
}

async function prepareVanillaRuntime(mcVersion: string, extractPath: string) {
  const versionManifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
  const manifestRes = await fetch(versionManifestUrl);
  const manifest = await manifestRes.json();

  const versionMeta = manifest.versions.find((v: any) => v.id === mcVersion);
  if (!versionMeta) throw new Error(`Version ${mcVersion} not found`);

  const metadataRes = await fetch(versionMeta.url);
  const metadata = await metadataRes.json();

  const serverJarUrl = metadata.downloads.server.url;
  const serverJarRes = await fetch(serverJarUrl);

  const jarPath = path.join(extractPath, "server.jar");
  const buffer = await serverJarRes.buffer();
  await fs.promises.writeFile(jarPath, buffer);

  return { success: true };
}

async function preparePaperRuntime(mcVersion: string, extractPath: string) {
  return { success: false, error: "Paper runtime is not implemented yet." };
}

async function prepareFabricRuntime(
  mcVersion: string,
  loaderVersion: string,
  extractPath: string
) {
  if (!mcVersion?.trim()) {
    throw new Error("Fabric runtime requires a Minecraft version.");
  }

  if (!loaderVersion?.trim()) {
    throw new Error("Fabric runtime requires a loader version.");
  }

  // 1) Get available Fabric installer versions
  const installerRes = await fetch("https://meta.fabricmc.net/v2/versions/installer");
  if (!installerRes.ok) {
    throw new Error(`Failed to fetch Fabric installer versions: ${installerRes.status} ${installerRes.statusText}`);
  }

  const installers = await installerRes.json();

  if (!Array.isArray(installers) || installers.length === 0) {
    throw new Error("No Fabric installer versions were returned.");
  }

  // Prefer a stable installer, otherwise fall back to the first one returned
  const chosenInstaller =
    installers.find((entry: any) => entry?.stable === true && entry?.version) ??
    installers.find((entry: any) => entry?.version);

  const installerVersion = chosenInstaller?.version;
  if (!installerVersion) {
    throw new Error("Could not determine a Fabric installer version.");
  }

  // 2) Download the Fabric server bootstrap jar
  const serverJarUrl =
    `https://meta.fabricmc.net/v2/versions/loader/` +
    `${encodeURIComponent(mcVersion)}/` +
    `${encodeURIComponent(loaderVersion)}/` +
    `${encodeURIComponent(installerVersion)}/server/jar`;

  const jarRes = await fetch(serverJarUrl);
  if (!jarRes.ok) {
    const errText = await jarRes.text().catch(() => "");
    throw new Error(
      `Failed to download Fabric server jar: ${jarRes.status} ${jarRes.statusText}` +
      (errText ? ` - ${errText}` : "")
    );
  }

  const buffer = await jarRes.buffer();
  await fs.promises.mkdir(path.join(extractPath, "mods"), { recursive: true });
  await fs.promises.mkdir(path.join(extractPath, "config"), { recursive: true });
  // Save as server.jar so your current startServerProcess logic can stay unchanged for now
  const jarPath = path.join(extractPath, "server.jar");
  await fs.promises.writeFile(jarPath, buffer);

  return { success: true };
}

ipcMain.handle("download-drive-folder", async (_event, args) => {
  try {
    const { accessToken, serverRootFolderId, folderName, localDestination } = args;

    const drive = createDriveClient(accessToken);

    const folderId = await findChildFolderId(drive, serverRootFolderId, folderName);
    if (!folderId) {
      // Not an error if the folder is empty/nonexistent in practice
      await fs.promises.mkdir(localDestination, { recursive: true });
      return { success: true };
    }

    await downloadDriveFolderRecursive({
      drive,
      folderId,
      localDestination,
    });

    return { success: true };
  } catch (error) {
    console.error(`Failed to download Drive folder:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("select-mod-files", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Minecraft Mods", extensions: ["jar"] },
    ],
  });

  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle("upload-mods-to-drive", async (_event, args) => {
  try {
    const { accessToken, serverId, loader, filePaths } = args;

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      throw new Error("No mod files were provided.");
    }

    const drive = createDriveClient(accessToken);

    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
    });

    const modsFolderId = await getOrCreateChildFolderId(drive, serverRootId, "mods");

    const uploaded: { id: string; name: string }[] = [];

    for (const filePath of filePaths) {
      const fileName = path.basename(filePath);

      if (!fileName.toLowerCase().endsWith(".jar")) {
        continue;
      }

      const existing = await drive.files.list({
        q: `'${modsFolderId}' in parents and name='${fileName}' and trashed=false`,
        fields: "files(id, name)",
      });

      for (const oldFile of existing.data.files ?? []) {
        await drive.files.delete({ fileId: oldFile.id! });
      }

      const created = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [modsFolderId],
        },
        media: {
          mimeType: "application/java-archive",
          body: fs.createReadStream(filePath),
        },
        fields: "id, name",
      });

      if (created.data.id && created.data.name) {
        uploaded.push({
          id: created.data.id,
          name: created.data.name,
        });
      }
    }

    return { success: true, uploaded };
  } catch (error) {
    console.error("Failed to upload mods to Drive:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("download-mods-to-folder", async (_event, args) => {
  try {
    const { accessToken, serverId, loader, localDestination } = args;

    if (!accessToken || !serverId || !loader || !localDestination) {
      throw new Error("Missing parameters for download-mods-to-folder.");
    }

    const drive = createDriveClient(accessToken);

    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
    });

    const modsFolderId = await findChildFolderId(drive, serverRootId, "mods");

    await fs.promises.mkdir(localDestination, { recursive: true });

    if (!modsFolderId) {
      return { success: true, downloadedCount: 0 };
    }

    const res = await drive.files.list({
      q: `'${modsFolderId}' in parents and trashed=false`,
      fields: "files(id, name, mimeType)",
      orderBy: "name",
      pageSize: 1000,
    });

    const files = (res.data.files ?? []).filter(
      (file: any) =>
        file.mimeType !== "application/vnd.google-apps.folder" &&
        file.name?.toLowerCase().endsWith(".jar")
    );

    await runWithConcurrency(files, 4, async (file: any) => {
      const targetPath = path.join(localDestination, file.name!);

      await downloadDriveFileToPath({
        drive,
        fileId: file.id!,
        targetPath,
      });
    });

    return { success: true, downloadedCount: files.length };
  } catch (error) {
    console.error("Failed to download mods to folder:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("list-drive-folder-files", async (_event, args) => {
  try {
    const { accessToken, serverId, loader, folderName } = args;

    const drive = createDriveClient(accessToken);

    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
    });

    const folderId = await findChildFolderId(drive, serverRootId, folderName);
    if (!folderId) return { success: true, files: [] };

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id, name, size, createdTime)",
      orderBy: "name",
      pageSize: 1000,
    });

    return {
      success: true,
      files: res.data.files ?? [],
    };
  } catch (error) {
    console.error("Failed to list Drive folder files:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      files: [],
    };
  }
});

ipcMain.handle("move-drive-file-between-server-folders", async (_event, args) => {
  try {
    const {
      accessToken,
      serverId,
      loader,
      fileId,
      fromFolderName,
      toFolderName,
    } = args;

    if (!accessToken || !serverId || !loader || !fileId || !fromFolderName || !toFolderName) {
      throw new Error("Missing parameters for move-drive-file-between-server-folders.");
    }

    const drive = createDriveClient(accessToken);

    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
    });

    const fromFolderId = await findChildFolderId(drive, serverRootId, fromFolderName);
    if (!fromFolderId) {
      throw new Error(`Source folder "${fromFolderName}" not found.`);
    }

    const toFolderId = await getOrCreateChildFolderId(drive, serverRootId, toFolderName);

    await drive.files.update({
      fileId,
      addParents: toFolderId,
      removeParents: fromFolderId,
      fields: "id, name, parents",
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to move Drive file between server folders:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("delete-drive-file", async (_event, args) => {
  try {
    const { accessToken, fileId } = args;
    const drive = createDriveClient(accessToken);

    await drive.files.delete({ fileId });

    return { success: true };
  } catch (error) {
    console.error("Failed to delete Drive file:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});


ipcMain.handle("prepare-server-runtime", async (_event, args) => {
  try {
    const { loader, mcVersion, loaderVersion, extractPath } = args;

    switch (loader) {
      case "vanilla":
        return await prepareVanillaRuntime(mcVersion, extractPath);

      case "paper":
        return await preparePaperRuntime(mcVersion, extractPath);

      case "purpur":
        return { success: false, error: "Purpur runtime is not implemented yet." };

      case "fabric":
        return await prepareFabricRuntime(mcVersion, loaderVersion || "", extractPath);

      case "forge":
        return { success: false, error: "Forge runtime is not implemented yet." };

      case "neoforge":
        return { success: false, error: "NeoForge runtime is not implemented yet." };

      default:
        return { success: false, error: `Unsupported loader: ${loader}` };
    }
  } catch (error) {
    console.error("Failed to prepare server runtime:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("link-drive", async (_event, { uid, serverId }) => {
  try {
    const tokens = await authenticateWithGoogle();
    console.log("TOKENS OK:", {
      hasAccessToken: !!tokens?.access_token,
      hasRefreshToken: !!tokens?.refresh_token,
      expiry: tokens?.expiry_date,
    });
    await fetch("https://europe-west1-mc-server-manager-6d2bc.cloudfunctions.net/handleDriveOAuth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, serverId, tokens }),
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});



// Polyfill a globális fetch, Headers, stb. számára Node-ban
(global as any).fetch = fetch;
(global as any).Headers = Headers;
(global as any).Request = Request;
(global as any).Response = Response;

let mainWindow: BrowserWindow | null = null;

const consoleWindows = new Map<string, BrowserWindow>();
let metricsWindow: BrowserWindow | null = null;
let ownerWindow: BrowserWindow | null = null;

function sendToRelevantWindows(channel: string, payload: any, serverId?: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }

  if (serverId) {
    const consoleWin = consoleWindows.get(serverId);
    if (consoleWin && !consoleWin.isDestroyed()) {
      consoleWin.webContents.send(channel, payload);
    }
  } else {
    for (const win of consoleWindows.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  if (metricsWindow && !metricsWindow.isDestroyed()) {
    metricsWindow.webContents.send(channel, payload);
  }
}

function getRendererUrl(hashPath: string) {
  const normalizedHash = hashPath.startsWith("/") ? hashPath : `/${hashPath}`;

  if (!app.isPackaged) {
    return `http://localhost:3000/#${normalizedHash}`;
  }

  const indexPath = path.join(process.resourcesPath, "app.asar", "build", "index.html");
  return `${pathToFileURL(indexPath).toString()}#${normalizedHash}`;
}

//const auth = new google.auth.GoogleAuth({
//  keyFile: path.join(__dirname, "../electron/credentials.json"), // Update path if needed
//  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
//});

function createWindow() {
  const isDev = !app.isPackaged;

  const preloadPath = isDev
    ? path.join(__dirname, "preload.js")
    : path.join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "preload.js");

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(process.resourcesPath, "app.asar", "build", "index.html");
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}



async function downloadFileFromDrive(driveZipId: string, destPath: string, accessToken: string) {
  const drive = createDriveClient(accessToken);

  const dest = fs.createWriteStream(destPath);
  

  await new Promise<void>((resolve, reject) => {
    drive.files.get(
      { fileId: driveZipId, alt: "media" },
      { responseType: "stream" },
      (err, res) => {
        if (err) {
          reject(err);
          return;
        }
	    if (!res || !res.data) {
	      reject(new Error("No response data from Google Drive"));
	      return;
	    }
        res.data
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .pipe(dest);
      }
    );
  });
}

ipcMain.handle("start-google-oauth", async () => {
  return new Promise((resolve, reject) => {
    const state = randomBytes(16).toString("hex");

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "", `http://${req.headers.host}`);
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>You can close this window now.</h2>");

        server.close();

        if (!code) return reject(new Error("No code returned"));
        if (returnedState !== state)
          return reject(new Error("Invalid state"));

        resolve({ code });
      } catch (err) {
        reject(err);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to start OAuth server"));
        return;
      }

      const redirectUri = `http://127.0.0.1:${address.port}`;

      const oauthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: client_id,   // 👈 from JSON
          response_type: "code",
          scope: "openid email profile https://www.googleapis.com/auth/drive.file",
          redirect_uri: redirectUri,
          access_type: "offline",
          prompt: "consent",
          state,
        }).toString();

      shell.openExternal(oauthUrl);
    });
  });
});

ipcMain.handle("backup-server", async (_e, args) => {
  const { serverPath, serverId, loader, accessToken, retention } = args;

  try {
    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
    });

    const keepCount = typeof retention === "number" ? retention : 5;

    await backupServerV2({
      serverPath,
      serverId,
      accessToken,
      driveBackupFolderId: serverRootId,
      retention: keepCount,
    });

    const allSnapshots = await listSnapshotFolders({
      accessToken,
      serverId,
      loader,
    });

    const snapshotsToDelete = allSnapshots.slice(keepCount);

    if (snapshotsToDelete.length > 0) {
      await deleteSnapshotFolders({
        accessToken,
        snapshotFolderIds: snapshotsToDelete.map((s) => s.id),
      });
    }

    const remainingSnapshots = await listSnapshotFolders({
      accessToken,
      serverId,
      loader,
    });

    const { referencedObjectFileIds, referencedPackFileIds } =
      await collectReferencedStoreFiles({
        accessToken,
        snapshots: remainingSnapshots,
      });

    const gcResult = await garbageCollectBackupStore({
      accessToken,
      serverRootFolderId: serverRootId,
      referencedObjectFileIds,
      referencedPackFileIds,
    });

    console.log("[retention] keepCount =", keepCount);
    console.log("[retention] deleted snapshots =", snapshotsToDelete.length);
    console.log("[retention] deleted objects =", gcResult.deletedObjects);
    console.log("[retention] deleted packs =", gcResult.deletedPacks);

    mainWindow?.webContents.send("prompt-delete-local-server", { serverPath });
    mainWindow?.webContents.send("backup-progress", {
      uploaded: 0,
      total: 0,
      percent: 0,
    });

    return { success: true };
  } catch (err: any) {
    console.error("❌ BACKUP V2 FAILED:", err);

    mainWindow?.webContents.send("backup-progress", {
      uploaded: 0,
      total: 0,
      percent: 0,
    });

    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle("get-drive-storage-info", async (_event, { accessToken }) => {
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const drive = google.drive({ version: "v3", auth });

    const res = await drive.about.get({
      fields: "storageQuota",
    });

    const quota = res.data.storageQuota || {};

    const limit = Number(quota.limit ?? 0);
    const usage = Number(quota.usage ?? 0);
    const usageInDrive = Number(quota.usageInDrive ?? usage);

    return {
      success: true,
      storage: {
        limit,
        usage,
        usageInDrive,
        free: Math.max(0, limit - usage),
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
});

ipcMain.handle("get-server-drive-usage", async (_event, { accessToken, serverId, loader }) => {
  try {
    const drive = createDriveClient(accessToken);

    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
    });

    let total = 0;
    const folderQueue: string[] = [serverRootId];

    while (folderQueue.length > 0) {
      const folderId = folderQueue.shift()!;

      let pageToken: string | undefined = undefined;

      do {
        const listRes: any = await drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: "nextPageToken, files(id, mimeType, size)",
          pageSize: 1000,
          pageToken,
        });

        for (const file of listRes.data.files ?? []) {
          if (file.mimeType === "application/vnd.google-apps.folder") {
            if (file.id) folderQueue.push(file.id);
          } else {
            total += Number(file.size ?? 0);
          }
        }

        pageToken = listRes.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    return { success: true, usage: total };
  } catch (error) {
    console.error("Failed to calculate server Drive usage:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      usage: 0,
    };
  }
});


ipcMain.handle("check-port-reachability", async (_event, { ip, port }) => {
  try {
    const res = await fetch(`https://api.mcstatus.io/v2/status/java/${ip}:${port}`);

    if (!res.ok) {
      return { success: false, reachable: false };
    }

    const data = await res.json();

    return {
      success: true,
      reachable: data.online === true,
      latency: data.debug?.ping ?? null
    };

  } catch (err) {
    console.error("Reachability check failed:", err);
    return { success: false, reachable: false };
  }
});



ipcMain.handle("list-server-backups", async (_event, { serverId, loader, accessToken }) => {
  try {
    const drive = createDriveClient(accessToken);

    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
    });

    const backupStore = await findChildFolderByName(drive, serverRootId, "backup-store");
    if (!backupStore) return [];

    const snapshotsFolder = await findChildFolderByName(drive, backupStore.id, "snapshots");
    if (!snapshotsFolder) return [];

    const res = await drive.files.list({
      q: `'${snapshotsFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name, createdTime)",
      orderBy: "createdTime desc",
      pageSize: 1000,
    });

    return (res.data.files ?? []).map((folder: any) => ({
      id: folder.id,
      name: folder.name,
      createdTime: folder.createdTime ?? null,
      type: "snapshot",
    }));
  } catch (error) {
    console.error("Failed to list V2 snapshots:", error);
    return [];
  }
});



// 📁 2. Drive downloader
ipcMain.handle("downloadFromDrive", async (_event, { fileId, destPath, accessToken }) => {
  if (!fileId || !destPath || !accessToken) {
    throw new Error("Missing parameters for downloadFromDrive");
  }

  try {
    const drive = createDriveClient(accessToken);

    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    if (!res || !res.data) throw new Error("No response data from Google Drive");

    await new Promise<void>((resolve, reject) => {
      const dest = fs.createWriteStream(destPath);
      res.data
        .on("end", () => resolve())
        .on("error", (err: any) => reject(err))
        .pipe(dest);
    });

    return { success: true };
  } catch (error) {
    console.error("Download failed:", error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  "restore-snapshot",
  async (_event, { snapshotId, serverPath, serverId, loader, accessToken }) => {
    try {

      const drive = createDriveClient(accessToken)

      const serverRootId = await ensureDriveFolderPath({
        accessToken,
        serverId,
        loader,
      })

      const backupStore = await findChildFolderByName(drive, serverRootId, "backup-store")
      if (!backupStore) throw new Error("backup-store missing")

      const snapshotsFolder = await findChildFolderByName(drive, backupStore.id, "snapshots")
      if (!snapshotsFolder) throw new Error("snapshots folder missing")

const structure = await ensureBackupStructure({
  accessToken,
  serverRootFolderId: serverRootId
})

await restoreSnapshotV2({
  drive,
  snapshotFolderId: snapshotId,
  serverPath,
  accessToken,
  structure
})

      return { success: true }

    } catch (err:any) {

      console.error("Snapshot restore failed:", err)

      return {
        success:false,
        error:err.message
      }

    }
  }
)
ipcMain.handle("get-valid-access-token", async (_e, args) => {
  console.log("🔥 get-valid-access-token CALLED", args);
  return await getValidAccessToken(args.userId, args.driveId);
});

ipcMain.handle("getValidAccessToken", async (event, createdBy, linkedDriveId) => {
  return await getValidAccessToken(createdBy, linkedDriveId);
});


ipcMain.handle("ensure-drive-folder-path", async (_e, args) => {
  const rootId = await ensureDriveFolderPath(args);

  const drive = createDriveClient(args.accessToken);

  const folders = ["backups", "mods", "config", "plugins"];

  for (const name of folders) {
    const existing = await drive.files.list({
      q: `'${rootId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id)",
    });

    if (!existing.data.files || existing.data.files.length === 0) {
      await drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [rootId],
        },
        fields: "id",
      });
    }
  }

  return rootId;
});


ipcMain.handle("create-server-zip", async (_e, args) => {
  try {
    const zipFileId = await createAndUploadServerZip(args);
    if (!zipFileId) throw new Error("Failed to create server zip");

    // CSAK stringet adunk vissza
    return { success: true, zipFileId };
  } catch (err) {
    console.error("❌ Failed to create server zip:", err);
    return { success: false, error: (err as Error).message };
  }
});






ipcMain.handle(
  "soft-delete-server",
  async (_event, serverPath: string, serverId: string) => {

    console.log("SOFT DELETE CALLED");
    console.log("serverPath =", serverPath);
    console.log("serverId =", serverId);

    if (!path.isAbsolute(serverPath)) {
      throw new Error("INVALID serverPath: " + serverPath);
    }

    if (!fs.existsSync(serverPath)) {
      throw new Error("PATH DOES NOT EXIST: " + serverPath);
    }

    const trashDir = path.join(app.getPath("userData"), ".trash");
    fs.mkdirSync(trashDir, { recursive: true });

    const target = path.join(
      trashDir,
      `${path.basename(serverPath)}_${Date.now()}`
    );

    fs.renameSync(serverPath, target);

    return { success: true };
  }
);


ipcMain.handle("get-public-ip", async () => {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return data.ip;
  } catch {
    return "127.0.0.1"; // fallback
  }
});

ipcMain.handle(
  "open-server-console",
  async (
    _e,
    {
      serverId,
      role,
      extractPath,
      ram,
      mcVersion,
      isAdmin,
    }: {
      serverId: string;
      role?: string;
      extractPath?: string;
      ram?: string | null;
      mcVersion?: string | null;
      isAdmin?: boolean;
    }
  ) => {
    const existing = consoleWindows.get(serverId);

    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { success: true };
    }

    const preloadPath = !app.isPackaged
      ? path.join(__dirname, "preload.js")
      : path.join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "preload.js");

    const consoleWin = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 800,
      minHeight: 520,
      autoHideMenuBar: true,
      backgroundColor: "#0b0b0b",
      title: `Server Console - ${serverId}`,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    consoleWindows.set(serverId, consoleWin);

    consoleWin.on("closed", () => {
      consoleWindows.delete(serverId);
    });

    const params = new URLSearchParams();
    if (extractPath) params.set("extractPath", extractPath);
    if (ram) params.set("ram", ram);
    if (mcVersion) params.set("mcVersion", mcVersion);
    if (typeof isAdmin === "boolean") params.set("isAdmin", String(isAdmin));

    const query = params.toString();
    const hashPath = `/console/${serverId}/${role ?? "admin"}${query ? `?${query}` : ""}`;

    await consoleWin.loadURL(getRendererUrl(hashPath));

    return { success: true };
  }
);

ipcMain.handle(
  "open-server-owner",
  async (_e, { serverId, accessToken }: { serverId: string; accessToken: string }) => {
    if (ownerWindow && !ownerWindow.isDestroyed()) {
      ownerWindow.show();
      ownerWindow.focus();
      return { success: true };
    }

    const preloadPath = !app.isPackaged
      ? path.join(__dirname, "preload.js")
      : path.join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "preload.js");

    ownerWindow = new BrowserWindow({
      width: 900,
      height: 700,
      minWidth: 700,
      minHeight: 500,
      autoHideMenuBar: true,
      backgroundColor: "#0b0b0b",
      title: `Owner - ${serverId}`,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    ownerWindow.on("closed", () => {
      ownerWindow = null;
    });

    const params = new URLSearchParams();
    params.set("serverId", serverId);
    params.set("accessToken", accessToken);

    await ownerWindow.loadURL(getRendererUrl(`/owner?${params.toString()}`));

    return { success: true };
  }
);

ipcMain.handle("open-server-metrics", async () => {
  if (metricsWindow && !metricsWindow.isDestroyed()) {
    metricsWindow.show();
    metricsWindow.focus();
    return { success: true };
  }

  const preloadPath = !app.isPackaged
    ? path.join(__dirname, "preload.js")
    : path.join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "preload.js");

  metricsWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 760,
    minHeight: 500,
    autoHideMenuBar: true,
    backgroundColor: "#0b0b0b",
    title: "Hosted Server Metrics",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  metricsWindow.on("closed", () => {
    metricsWindow = null;
  });

  await metricsWindow.loadURL(getRendererUrl(`/metrics`));


  return { success: true };
});

ipcMain.handle("get-running-server-metrics", async () => {
  const servers = await Promise.all(
    Array.from(runningServers.values()).map((running) => buildRunningServerSnapshot(running))
  );

  const history: Record<string, MetricSample[]> = {};

  for (const server of servers) {
    history[server.serverId] = serverMetricsHistory.get(server.serverId) ?? [];
  }

  return {
    success: true,
    servers,
    history,
    historyWindowMinutes: metricsHistoryWindowMinutes,
    maxSamples: getMetricsMaxSamples(),
    sampleIntervalMs: METRICS_SAMPLE_INTERVAL_MS,
  };
});

ipcMain.handle("set-metrics-history-window", async (_, minutes: number) => {
  if (!METRICS_WINDOW_OPTIONS_MIN.includes(minutes as MetricsWindowMinutes)) {
    return {
      success: false,
      error: "Invalid metrics history window",
    };
  }

  metricsHistoryWindowMinutes = minutes as MetricsWindowMinutes;

  for (const [serverId, samples] of serverMetricsHistory.entries()) {
    serverMetricsHistory.set(
      serverId,
      trimMetricHistory(samples, metricsHistoryWindowMinutes)
    );
  }

  return {
    success: true,
    historyWindowMinutes: metricsHistoryWindowMinutes,
    maxSamples: getMetricsMaxSamples(),
    sampleIntervalMs: METRICS_SAMPLE_INTERVAL_MS,
  };
});

ipcMain.handle("createEula", async (_event, folderPath: string) => {
  const eulaPath = path.join(folderPath, "eula.txt");
  try {
    await fs.promises.writeFile(eulaPath, "eula=true\n", "utf-8");
    console.log("✅ eula.txt created at", eulaPath);
    return true;
  } catch (error) {
    console.error("❌ Failed to create eula.txt:", error);
    return false;
  }
});


ipcMain.handle("extractZip", async (_event, zipPath: string, extractTo: string) => {
  try {
    const stream = fs.createReadStream(zipPath);
    await new Promise((resolve, reject) => {
      stream
        .pipe(unzipper.Extract({ path: extractTo }))
        .on("close", resolve)
        .on("error", reject);
    });

    stream.close(); // ✅ Make sure it's closed explicitly

    await fs.promises.unlink(zipPath); // Then safely delete
    console.log("✅ Extracted and deleted zip:", zipPath);
    return true;
  } catch (error) {
    console.error("❌ Extraction or deletion failed:", error);
    return false;
  }
});

ipcMain.handle("downloadMinecraftJar", async (_event, version: string, destFolder: string) => {
  try {
    const versionManifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    const manifestRes = await fetch(versionManifestUrl);
    const manifest = await manifestRes.json();

    const versionMeta = manifest.versions.find((v: any) => v.id === version);
    if (!versionMeta) throw new Error(`Version ${version} not found`);

    const metadataRes = await fetch(versionMeta.url);
    const metadata = await metadataRes.json();

    const serverJarUrl = metadata.downloads.server.url;
    const serverJarRes = await fetch(serverJarUrl);

    const jarPath = path.join(destFolder, "server.jar");
    const buffer = await serverJarRes.buffer();
    await fs.promises.writeFile(jarPath, buffer);

    return { success: true };
  } catch (error) {
    console.error("Failed to download Minecraft jar:", error);
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: String(error) };
  }
});


async function isPortFree(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

async function findFreePort(startPort = 25565, maxPort = 25650): Promise<number> {
  for (let port = startPort; port <= maxPort; port++) {
    const free = await isPortFree(port);
    if (free) return port;
  }

  throw new Error(`No free port found between ${startPort} and ${maxPort}`);
}

//managing server processes
type ServerRuntimeState =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "crashed";

type RunningServer = {
  serverId: string;
  proc: ChildProcessWithoutNullStreams;
  pathToServerJar: string;
  ram: string;
  startedAt: number;
  port: number;
  logs: string[];
  state: ServerRuntimeState;
  stopRequested: boolean;
  forceKillTimer?: NodeJS.Timeout;
  restartOnCrash?: boolean;
  restartAttempts: number;
  maxRestartAttempts: number;
  restartDelayMs: number;
  upnpStatus?: "idle" | "opening" | "mapped" | "failed" | "closing";
  upnpError?: string | null;
};

const runningServers = new Map<string, RunningServer>();
const serverLogHistory = new Map<string, string[]>();

type MetricSample = {
  t: number;
  cpu: number;
  memoryMb: number;
};

const METRICS_SAMPLE_INTERVAL_MS = 1500;
const METRICS_WINDOW_OPTIONS_MIN = [3, 6, 9] as const;
type MetricsWindowMinutes = (typeof METRICS_WINDOW_OPTIONS_MIN)[number];

let metricsHistoryWindowMinutes: MetricsWindowMinutes = 6;

const serverMetricsHistory = new Map<string, MetricSample[]>();

function getMetricsMaxSamples(minutes: MetricsWindowMinutes = metricsHistoryWindowMinutes) {
  return Math.max(1, Math.floor((minutes * 60 * 1000) / METRICS_SAMPLE_INTERVAL_MS));
}

function trimMetricHistory(samples: MetricSample[], minutes: MetricsWindowMinutes = metricsHistoryWindowMinutes) {
  const maxSamples = getMetricsMaxSamples(minutes);
  return samples.length > maxSamples ? samples.slice(-maxSamples) : samples;
}

async function buildRunningServerSnapshot(running: RunningServer) {
  const pid = running.proc.pid ?? null;

  let cpu = 0;
  let memoryMb = 0;
  let status: string = running.state;

  if (pid !== null) {
    try {
      const stats = await pidusage(pid);
      const cpuCoreCount = Math.max(1, os.cpus().length);
      const normalizedCpu = stats.cpu / cpuCoreCount;

      cpu = Number(Math.max(0, Math.min(normalizedCpu, 100)).toFixed(1));
      memoryMb = Number((stats.memory / 1024 / 1024).toFixed(1));
    } catch (error) {
      status = "unknown";
    }
  } else {
    status = "unknown";
  }

  return {
    serverId: running.serverId,
    pid,
    cpu,
    memoryMb,
    ram: running.ram,
    port: running.port,
    startedAt: running.startedAt,
    uptimeSec: Math.max(0, Math.floor((Date.now() - running.startedAt) / 1000)),
    status,
  };
}

async function sampleRunningServerMetrics() {
  const snapshots = await Promise.all(
    Array.from(runningServers.values()).map((running) => buildRunningServerSnapshot(running))
  );

  const activeIds = new Set(snapshots.map((s) => s.serverId));

  for (const snapshot of snapshots) {
    const existing = serverMetricsHistory.get(snapshot.serverId) ?? [];
    existing.push({
      t: Date.now(),
      cpu: snapshot.cpu,
      memoryMb: snapshot.memoryMb,
    });

    serverMetricsHistory.set(
      snapshot.serverId,
      trimMetricHistory(existing, metricsHistoryWindowMinutes)
    );
  }

  for (const serverId of Array.from(serverMetricsHistory.keys())) {
    if (!activeIds.has(serverId)) {
      serverMetricsHistory.delete(serverId);
    }
  }
}

setInterval(() => {
  sampleRunningServerMetrics().catch((err) => {
    console.error("[mc-server-manager] Metrics sampler failed:", err);
  });
}, METRICS_SAMPLE_INTERVAL_MS);

function appendServerLog(serverId: string, logChunk: string) {
  const existing = serverLogHistory.get(serverId) ?? [];
  existing.push(logChunk);

  const trimmed = existing.length > 1000 ? existing.slice(-1000) : existing;
  serverLogHistory.set(serverId, trimmed);

  const running = runningServers.get(serverId);
  if (running) {
    running.logs = [...trimmed];
  }
}

function emitServerState(serverId: string) {
  const running = runningServers.get(serverId);

  if (running) {
    sendToRelevantWindows(
      "server-state",
      {
        serverId,
        state: running.state,
        port: running.port,
        pid: running.proc.pid ?? null,
        startedAt: running.startedAt,
        upnpStatus: running.upnpStatus ?? "idle",
        upnpError: running.upnpError ?? null,
      },
      serverId
    );
    return;
  }

  sendToRelevantWindows(
    "server-state",
    {
      serverId,
      state: "stopped",
      port: null,
      pid: null,
      startedAt: null,
      upnpStatus: "idle",
      upnpError: null,
    },
    serverId
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
}

function normalizeUpnpError(err: any): string {
  const raw = err?.message || String(err);

  if (/timeout/i.test(raw)) {
    return "Router did not respond to the UPnP request";
  }

  if (/500/.test(raw)) {
    return "Router rejected the automatic port-forward request";
  }

  return raw;
}

function mapUpnpPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    upnpClient.portMapping(
      {
        public: port,
        private: port,
        ttl: 0,
        protocol: "TCP",
        description: "mc-server-manager",
      },
      (err: any) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

function unmapUpnpPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    upnpClient.portUnmapping(
      {
        public: port,
        protocol: "TCP",
      },
      (err: any) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function openUpnpForServer(serverId: string) {
  const running = runningServers.get(serverId);
  if (!running) return;

  if (upnpAvailability === "unavailable") {
    running.upnpStatus = "failed";
    running.upnpError = "Automatic port forwarding is unavailable on this router/network";
    emitServerState(serverId);
    return;
  }

  running.upnpStatus = "opening";
  running.upnpError = null;
  emitServerState(serverId);

  try {
    await withTimeout(mapUpnpPort(running.port), 4000, "UPnP mapping");

    const latest = runningServers.get(serverId);
    if (!latest) return;

    upnpAvailability = "available";
    latest.upnpStatus = "mapped";
    latest.upnpError = null;

    const log = `[mc-server-manager] UPnP port mapping opened for ${latest.port}\n`;
    appendServerLog(serverId, log);
    sendToRelevantWindows("server-log", { serverId, log }, serverId);
  } catch (err: any) {
    const latest = runningServers.get(serverId);
    if (!latest) return;

    upnpAvailability = "unavailable";
    latest.upnpStatus = "failed";
    latest.upnpError = normalizeUpnpError(err);

    const log = `[mc-server-manager] UPnP port mapping failed: ${latest.upnpError}\n`;
    appendServerLog(serverId, log);
    sendToRelevantWindows("server-log", { serverId, log }, serverId);
  }

  emitServerState(serverId);
}

async function closeUpnpForServer(serverId: string, port: number) {
  if (upnpAvailability === "unavailable") {
    return;
  }

  try {
    await withTimeout(unmapUpnpPort(port), 3000, "UPnP unmapping");

    const latest = runningServers.get(serverId);
    if (latest) {
      latest.upnpStatus = "idle";
      latest.upnpError = null;
      emitServerState(serverId);
    }

    const log = `[mc-server-manager] UPnP port mapping closed for ${port}\n`;
    appendServerLog(serverId, log);
    sendToRelevantWindows("server-log", { serverId, log }, serverId);
  } catch (err: any) {
    const latest = runningServers.get(serverId);
    if (latest) {
      latest.upnpStatus = "failed";
      latest.upnpError = normalizeUpnpError(err);
      emitServerState(serverId);
    }

    const log = `[mc-server-manager] Failed to close UPnP mapping for ${port}: ${normalizeUpnpError(err)}\n`;
    appendServerLog(serverId, log);
    sendToRelevantWindows("server-log", { serverId, log }, serverId);
  }
}


type LaunchServerProcessArgs = {
  serverId: string;
  pathToServerJar: string;
  ram: string;
  preferredPort?: number;
  restartOnCrash?: boolean;
  restartAttempts?: number;
  maxRestartAttempts?: number;
  restartDelayMs?: number;
  launchReason?: "manual" | "restart";
};

function handleServerReadyFromLog(serverId: string, log: string) {
  const current = runningServers.get(serverId);
  if (
    current &&
    current.state === "starting" &&
    /Done \([^)]+\)! For help, type "help"/i.test(log)
  ) {
    current.state = "running";
    current.restartAttempts = 0;
    emitServerState(serverId);
  }
}

async function scheduleAutoRestart(args: {
  serverId: string;
  pathToServerJar: string;
  ram: string;
  preferredPort?: number;
  restartOnCrash?: boolean;
  restartAttempts: number;
  maxRestartAttempts: number;
  restartDelayMs: number;
}) {
  const log = `[mc-server-manager] Crash detected. Restarting in ${Math.floor(
    args.restartDelayMs / 1000
  )} seconds (attempt ${args.restartAttempts}/${args.maxRestartAttempts})\n`;

  appendServerLog(args.serverId, log);
  sendToRelevantWindows("server-log", { serverId: args.serverId, log }, args.serverId);

  setTimeout(async () => {
    const existing = runningServers.get(args.serverId);
    if (existing) return;

    try {
      await launchServerProcess({
        serverId: args.serverId,
        pathToServerJar: args.pathToServerJar,
        ram: args.ram,
        preferredPort: args.preferredPort,
        restartOnCrash: args.restartOnCrash,
        restartAttempts: args.restartAttempts,
        maxRestartAttempts: args.maxRestartAttempts,
        restartDelayMs: args.restartDelayMs,
        launchReason: "restart",
      });
    } catch (err: any) {
      const errLog = `[mc-server-manager] Auto-restart failed: ${err?.message || String(err)}\n`;
      appendServerLog(args.serverId, errLog);
      sendToRelevantWindows("server-log", { serverId: args.serverId, log: errLog }, args.serverId);
    }
  }, args.restartDelayMs);
}

async function launchServerProcess({
  serverId,
  pathToServerJar,
  ram,
  preferredPort,
  restartOnCrash = true,
  restartAttempts = 0,
  maxRestartAttempts = 3,
  restartDelayMs = 5000,
  launchReason = "manual",
}: LaunchServerProcessArgs): Promise<{ success: boolean; error?: string; port?: number }> {
  if (!serverId) {
    return { success: false, error: "Missing serverId" };
  }

  const existing = runningServers.get(serverId);
  if (existing && !existing.proc.killed) {
    return {
      success: false,
      error: "This server is already running.",
      port: existing.port,
    };
  }

const chosenPort =
  typeof preferredPort === "number" && preferredPort > 0
    ? (await isPortFree(preferredPort))
      ? preferredPort
      : await findFreePort(25565, 25650)
    : await findFreePort(25565, 25650);

  const serverFolder = path.dirname(pathToServerJar);

  const writePropsResult = await writeServerPropertiesFile(serverFolder, {
    "server-port": String(chosenPort),
  });

  if (!writePropsResult.success) {
    return {
      success: false,
      error: writePropsResult.error || "Failed to write server.properties",
    };
  }

  const args = [
    `-Xmx${ram}`,
    `-Xms${ram}`,
    "-jar",
    pathToServerJar,
    "nogui",
  ];

  const proc = spawn("java", args, {
    cwd: serverFolder,
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout.on("data", (data: Buffer) => {
    const log = data.toString();
    appendServerLog(serverId, log);
    handleServerReadyFromLog(serverId, log);
    sendToRelevantWindows("server-log", { serverId, log }, serverId);
  });

  proc.stderr.on("data", (data: Buffer) => {
    const log = data.toString();
    appendServerLog(serverId, log);
    handleServerReadyFromLog(serverId, log);
    sendToRelevantWindows("server-log", { serverId, log }, serverId);
  });

  proc.on("error", (err: Error) => {
    const log = `[mc-server-manager] Process error: ${err.message}\n`;
    appendServerLog(serverId, log);
    sendToRelevantWindows("server-log", { serverId, log }, serverId);
  });

  proc.on("close", (code: number | null) => {
    const current = runningServers.get(serverId);

    if (current?.forceKillTimer) {
      clearTimeout(current.forceKillTimer);
    }

    const wasStopRequested = current?.stopRequested ?? false;
    const finalState = wasStopRequested ? "stopped" : "crashed";

    const shouldRestart =
      !!current &&
      !wasStopRequested &&
      !!current.restartOnCrash &&
      current.restartAttempts < current.maxRestartAttempts;

    const restartConfig = current
      ? {
          serverId: current.serverId,
          pathToServerJar: current.pathToServerJar,
          ram: current.ram,
          preferredPort: current.port,
          restartOnCrash: current.restartOnCrash,
          restartAttempts: current.restartAttempts + 1,
          maxRestartAttempts: current.maxRestartAttempts,
          restartDelayMs: current.restartDelayMs,
        }
      : null;

if (current) {
  current.state = finalState;
  if (current.upnpStatus === "mapped") {
    current.upnpStatus = "closing";
  }
}

    emitServerState(serverId);

    sendToRelevantWindows(
      "server-closed",
      {
        serverId,
        code: code ?? 0,
        expected: wasStopRequested,
        state: finalState,
      },
      serverId
    );

if (current?.port && current.upnpStatus === "mapped") {
  void closeUpnpForServer(serverId, current.port);
}

    runningServers.delete(serverId);


    if (shouldRestart && restartConfig) {
      void scheduleAutoRestart(restartConfig);
    }
  });

  runningServers.set(serverId, {
    serverId,
    proc,
    pathToServerJar,
    ram,
    startedAt: Date.now(),
    port: chosenPort,
    logs: serverLogHistory.get(serverId) ?? [],
    state: "starting",
    stopRequested: false,
    restartOnCrash,
    restartAttempts,
    maxRestartAttempts,
    restartDelayMs,
    upnpStatus: "idle",
    upnpError: null,
  });
  
  emitServerState(serverId);
  void openUpnpForServer(serverId);

  const launchLog =
    launchReason === "restart"
      ? `[mc-server-manager] Auto-restart attempt started on port ${chosenPort}\n`
      : `[mc-server-manager] Assigned port ${chosenPort}\n`;

  appendServerLog(serverId, launchLog);
  sendToRelevantWindows("server-log", { serverId, log: launchLog }, serverId);


  return { success: true, port: chosenPort };
}

ipcMain.handle("getRunningServerInfo", async (_event, { serverId }: { serverId: string }) => {
  const running = runningServers.get(serverId);

  if (!running) {
    return {
      success: true,
      running: false,
    };
  }

return {
  success: true,
  running: true,
  data: {
    serverId: running.serverId,
    extractPath: path.dirname(running.pathToServerJar),
    pathToServerJar: running.pathToServerJar,
    ram: running.ram,
    port: running.port,
    startedAt: running.startedAt,
    pid: running.proc.pid ?? null,
    state: running.state,
    upnpStatus: running.upnpStatus ?? "idle",
    upnpError: running.upnpError ?? null,
  },
};
});

ipcMain.handle(
  "getServerLogs",
  async (_event, { serverId, limit = 1000 }: { serverId: string; limit?: number }) => {
    const logs = serverLogHistory.get(serverId) ?? [];

    return {
      success: true,
      logs: logs.slice(-Math.max(1, limit)),
    };
  }
);

ipcMain.handle(
  "startServerProcess",
  async (
    _event,
    {
      serverId,
      pathToServerJar,
      ram,
      preferredPort,
    }: {
      serverId: string;
      pathToServerJar: string;
      ram: string;
      preferredPort?: number;
    }
  ) => {
    try {
      return await launchServerProcess({
        serverId,
        pathToServerJar,
        ram,
        preferredPort,
        restartOnCrash: true,
        restartAttempts: 0,
        maxRestartAttempts: 3,
        restartDelayMs: 5000,
        launchReason: "manual",
      });
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }
);

ipcMain.handle(
  "stopServerProcess",
  async (_event, { serverId }: { serverId: string }) => {
    const running = runningServers.get(serverId);

    if (!running) {
      return { success: false, error: "No running server found for this serverId." };
    }

    if (running.state === "stopping") {
      return { success: true };
    }

    const proc = running.proc;

    if (!proc.stdin || !proc.stdin.writable) {
      return { success: false, error: "Server stdin is not writable." };
    }

    try {
      running.state = "stopping";
      running.stopRequested = true;
      emitServerState(serverId);

      proc.stdin.write("save-all\n");
      proc.stdin.write("stop\n");

      const log = `[mc-server-manager] Graceful shutdown requested\n`;
      appendServerLog(serverId, log);
      sendToRelevantWindows("server-log", { serverId, log }, serverId);

      running.forceKillTimer = setTimeout(() => {
        const latest = runningServers.get(serverId);
        if (!latest) return;
        if (latest.proc.killed) return;

        const timeoutLog = `[mc-server-manager] Graceful shutdown timed out, forcing process kill\n`;
        appendServerLog(serverId, timeoutLog);
        sendToRelevantWindows("server-log", { serverId, log: timeoutLog }, serverId);

        try {
          latest.proc.kill();
        } catch (err: any) {
          const errLog = `[mc-server-manager] Forced kill failed: ${err?.message || String(err)}\n`;
          appendServerLog(serverId, errLog);
          sendToRelevantWindows("server-log", { serverId, log: errLog }, serverId);
        }
      }, 15000);

      return { success: true };
    } catch (error: any) {
      running.state = "running";
      running.stopRequested = false;
      return { success: false, error: error.message || String(error) };
    }
  }
);
ipcMain.handle(
  "sendServerCommand",
  async (_event, { serverId, command }: { serverId: string; command: string }) => {
    const running = runningServers.get(serverId);

    if (!running) {
      return { success: false, error: "Server is not running" };
    }

    const proc = running.proc;

    if (!proc.stdin || !proc.stdin.writable) {
      return { success: false, error: "Server stdin is not writable" };
    }

    proc.stdin.write(command + "\n");
    return { success: true };
  }
);

async function writeServerPropertiesFile(
  folderPath: string,
  updates: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    const filePath = path.join(folderPath, "server.properties");

    let parsed: Record<string, any> = {};

    if (fs.existsSync(filePath)) {
      const fileContent = await fs.promises.readFile(filePath, "utf-8");
      parsed = ini.parse(fileContent);
    }

    for (const [key, value] of Object.entries(updates)) {
      parsed[key] = value;
    }

    const newContent = ini.stringify(parsed);
    await fs.promises.writeFile(filePath, newContent, "utf-8");

    return { success: true };
  } catch (error) {
    console.error("Failed to write server.properties:", error);
    return { success: false, error: (error as Error).message };
  }
}

// Helper function: Read server.properties and return key-values for the UI keys
ipcMain.handle("readServerProperties", async (_event, folderPath: string) => {
  try {
    const filePath = path.join(folderPath, "server.properties");
    const fileContent = await fs.promises.readFile(filePath, "utf-8");
    const parsed = ini.parse(fileContent);

    // Keys we want to expose to UI
    const keys = [
      "view-distance",
      "simulation-distance",
      "max-players",
      "gamemode",
      "difficulty",
      "pvp",
      "motd",
    ];

    // Extract only needed keys, fallback to default values if missing
    const filtered: Record<string, string> = {};
    for (const key of keys) {
      filtered[key] = parsed[key] ?? "";
    }

    return { success: true, data: filtered };
  } catch (error) {
    console.error("Failed to read server.properties:", error);
    return { success: false, error: (error as Error).message };
  }
});

// Helper function: Write server.properties keys from UI input
ipcMain.handle(
  "writeServerProperties",
  async (_event, folderPath: string, updates: Record<string, string>) => {
    return await writeServerPropertiesFile(folderPath, updates);
  }
);

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}


