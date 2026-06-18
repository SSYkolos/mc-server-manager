import 'dotenv/config';
import axios from "axios";
import { createSnapshot } from "./backup";
import { app, BrowserWindow, ipcMain, shell, dialog, screen } from 'electron';
import * as path from 'path';
import * as fs from "fs";
import { google } from "googleapis";
import fetch, { Headers, Request, Response } from 'node-fetch';
import unzipper from "unzipper";
import { unlink } from "fs/promises";
import archiver from "archiver";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as ini from "ini";
import crypto from "crypto";

import { resolveJavaExecutable } from "./JavaScanner";
import { getValidAccessToken } from "./getValidAccessToken";
import { ensureDriveFolderPath } from "./driveFolderManager";
import { ensureServerBackupFolder } from "./driveFolderManager";
import { createAndUploadServerZip } from "./createServerZipAndUpload";
import { createBackupZip } from "./createBackupZip";
import { uploadResumableToDrive } from "./driveResumableUpload";
import { getOrCreateFolder } from "./driveFolderManager";
import os from "os";
import { createDriveClient } from "./googleAuth";
import http from "http";
import { randomBytes } from "crypto";
import open from "open";
import type { AddressInfo } from "net";
import net from "net";
import { copyFile } from "fs/promises";
import { pathToFileURL } from "url";
import { backupServerV2 } from "./backup/backupServerV2";
import { restoreSnapshotV2, verifySnapshotRestoreV2 } from "./backup/restoreSnapshotV2";
import { Readable } from "stream";



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

const accessTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();

function getAccessTokenCacheKey(userId: string, driveId: string) {
  return `${userId}::${driveId}`;
}

//fejlesztoi kornyezet
if (!app.isPackaged) {
  // A require.resolve segít megtalálni a projekt gyökerét a node_modules-hoz képest
  const projectRoot = path.join(require.resolve('electron-reload'), '..', '..', '..');

  require('electron-reload')(projectRoot, {
    electron: path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  });
}

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

type ModSideValue = "required" | "optional" | "unsupported" | "unknown";
type ModSideSupport = "server" | "client" | "both" | "optional" | "unknown";


type ModDependencyType =
  | "required"
  | "optional"
  | "incompatible"
  | "embedded"
  | "unknown";

type ForgeLaunchInfo =
  | {
    mode: "jar";
    jarPath: string;
  }
  | {
    mode: "args";
    userJvmArgsPath: string;
    winArgsPath?: string;
    unixArgsPath?: string;
  };

type ModDependency = {
  projectId: string;
  dependencyType: ModDependencyType;
  title: string;
  clientSide: ModSideValue;
  serverSide: ModSideValue;
  sideSupport: ModSideSupport;
  alreadyInstalled: boolean;
};

type InstallWarningCode =
  | "client-only"
  | "unknown-side"
  | "duplicate-project"
  | "missing-required-dependencies";

type InstallWarning = {
  code: InstallWarningCode;
  message: string;
};

type ModInstallPreview = {
  success: boolean;
  project?: {
    provider: "modrinth";
    projectId: string;
    title: string;
    versionId: string;
    versionNumber?: string;
    fileName: string;
    clientSide: ModSideValue;
    serverSide: ModSideValue;
    sideSupport: ModSideSupport;
  };
  dependencies?: ModDependency[];
  warnings?: InstallWarning[];
  error?: string;
};

type DiscoveredMod = {
  id: string;
  provider: "modrinth" | "curseforge";
  projectId: string;
  slug?: string;
  title: string;
  description: string;
  iconUrl?: string;
  downloads?: number;
  loaders: string[];
  gameVersions: string[];
  clientSide: ModSideValue;
  serverSide: ModSideValue;
  sideSupport: ModSideSupport;
};

function classifyModSide(args: {
  clientSide?: string;
  serverSide?: string;
}): ModSideSupport {
  const client = (args.clientSide || "unknown").toLowerCase();
  const server = (args.serverSide || "unknown").toLowerCase();

  if (client === "required" && server === "required") return "both";
  if (server === "required" && client !== "required") return "server";
  if (client === "required" && server !== "required") return "client";

  if (
    ["optional", "unsupported", "unknown"].includes(client) &&
    ["optional", "unsupported", "unknown"].includes(server)
  ) {
    return "optional";
  }

  return "unknown";
}

function getModrinthHeaders() {
  return {
    "User-Agent": "mc-server-manager/1.0 (desktop app, contact: local-app)",
    "Content-Type": "application/json",
  };
}

function normalizeLoaderForModrinth(loader: string): string {
  const normalized = (loader || "").toLowerCase();
  if (normalized === "neoforge") return "neoforge";
  if (normalized === "forge") return "forge";
  if (normalized === "fabric") return "fabric";
  if (normalized === "quilt") return "quilt";
  return normalized;
}

async function forgeArtifactExists(mcVersion: string, loaderVersion: string): Promise<boolean> {
  const installerFileName = `forge-${mcVersion}-${loaderVersion}-installer.jar`;
  const installerUrl =
    `https://maven.minecraftforge.net/net/minecraftforge/forge/` +
    `${encodeURIComponent(mcVersion)}-${encodeURIComponent(loaderVersion)}/` +
    `${installerFileName}`;

  const res = await fetch(installerUrl, { method: "HEAD" });
  return res.ok;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureEmptyDir(dirPath: string) {
  await fs.promises.rm(dirPath, { recursive: true, force: true });
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function copyDirectoryRecursive(sourceDir: string, targetDir: string) {
  await fs.promises.mkdir(targetDir, { recursive: true });

  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(src, dst);
    } else if (entry.isFile()) {
      await fs.promises.mkdir(path.dirname(dst), { recursive: true });
      await copyFile(src, dst);
    }
  }
}

async function copyOptionalFileIfExists(sourceFile: string, targetFile: string): Promise<boolean> {
  if (!(await pathExists(sourceFile))) return false;

  await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });
  await copyFile(sourceFile, targetFile);
  return true;
}

async function copyOptionalFolderIfExists(sourceDir: string, targetDir: string): Promise<boolean> {
  const stat = await fs.promises.stat(sourceDir).catch(() => null);
  if (!stat || !stat.isDirectory()) return false;

  await ensureEmptyDir(targetDir);
  await copyDirectoryRecursive(sourceDir, targetDir);
  return true;
}

async function readImportedLevelName(sourceServerPath: string): Promise<string> {
  const propsPath = path.join(sourceServerPath, "server.properties");

  try {
    const raw = await fs.promises.readFile(propsPath, "utf8");
    const parsed = ini.parse(raw);
    const levelName = String(parsed["level-name"] || "").trim();
    return levelName || "world";
  } catch {
    return "world";
  }
}

async function uploadLocalFolderToDriveRecursive(args: {
  drive: any;
  parentFolderId: string;
  localSourcePath: string;
}): Promise<number> {
  const { drive, parentFolderId, localSourcePath } = args;

  const stat = await fs.promises.stat(localSourcePath).catch(() => null);
  if (!stat || !stat.isDirectory()) return 0;

  const entries = await fs.promises.readdir(localSourcePath, { withFileTypes: true });
  let uploadedCount = 0;

  for (const entry of entries) {
    const localPath = path.join(localSourcePath, entry.name);

    if (entry.isDirectory()) {
      const childFolderId = await getOrCreateChildFolderId(drive, parentFolderId, entry.name);
      uploadedCount += await uploadLocalFolderToDriveRecursive({
        drive,
        parentFolderId: childFolderId,
        localSourcePath: localPath,
      });
      continue;
    }

    if (!entry.isFile()) continue;

    const existing = await drive.files.list({
      q: `'${parentFolderId}' in parents and name='${entry.name.replace(/'/g, "\\'")}' and trashed=false`,
      fields: "files(id, name)",
      pageSize: 50,
    });

    for (const oldFile of existing.data.files ?? []) {
      await drive.files.delete({ fileId: oldFile.id! });
    }

    await drive.files.create({
      requestBody: {
        name: entry.name,
        parents: [parentFolderId],
      },
      media: {
        body: fs.createReadStream(localPath),
      },
      fields: "id",
    });

    uploadedCount += 1;
  }

  return uploadedCount;
}

async function writeImportedServerProperties(args: {
  serverDir: string;
  levelName?: string;
  port?: number | null;
}) {
  const { serverDir, levelName, port } = args;
  const propsPath = path.join(serverDir, "server.properties");

  let existing = "";
  try {
    existing = await fs.promises.readFile(propsPath, "utf8");
  } catch {
    existing = "";
  }

  const parsed = ini.parse(existing);

  parsed["level-name"] = levelName && levelName.trim() ? levelName.trim() : "world";
  parsed["server-port"] = typeof port === "number" ? String(port) : (parsed["server-port"] || "25565");
  parsed["enable-query"] = parsed["enable-query"] ?? "false";
  parsed["enable-rcon"] = parsed["enable-rcon"] ?? "false";
  parsed["motd"] = parsed["motd"] ?? "A Minecraft Server";

  const serialized = ini.stringify(parsed);
  await fs.promises.writeFile(propsPath, serialized, "utf8");
}

function parseBooleanLike(value: any, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function parseNumberLike(value: any, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// get properties saved in server
function extractImportableServerSettingsFromProperties(raw: string) {
  const parsed = ini.parse(raw);

  return {
    motd: String(parsed["motd"] ?? "A Minecraft Server"),
    levelName: String(parsed["level-name"] ?? "world"),
    gamemode: String(parsed["gamemode"] ?? "survival"),
    difficulty: String(parsed["difficulty"] ?? "easy"),
    pvp: parseBooleanLike(parsed["pvp"], true),
    hardcore: parseBooleanLike(parsed["hardcore"], false),
    allowFlight: parseBooleanLike(parsed["allow-flight"], false),
    maxPlayers: parseNumberLike(parsed["max-players"], 20),
    onlineMode: parseBooleanLike(parsed["online-mode"], true),
    whiteList: parseBooleanLike(parsed["white-list"], false),
    enforceWhitelist: parseBooleanLike(parsed["enforce-whitelist"], false),
    enableCommandBlock: parseBooleanLike(parsed["enable-command-block"], false),
    allowNether: parseBooleanLike(parsed["allow-nether"], true),
    enableStatus: parseBooleanLike(parsed["enable-status"], true),
    enableRcon: parseBooleanLike(parsed["enable-rcon"], false),
    rconPassword: String(parsed["rcon.password"] ?? ""),
    resourcePack: String(parsed["resource-pack"] ?? ""),
    viewDistance: parseNumberLike(parsed["view-distance"], 10),
    maxWorldSize: parseNumberLike(parsed["max-world-size"], 10000),
    spawnProtection: parseNumberLike(parsed["spawn-protection"], 16),
    syncChunkWrites: parseBooleanLike(parsed["sync-chunk-writes"], true),
  };
}


function normalizeDependencyType(value: any): ModDependencyType {
  const v = String(value || "unknown").toLowerCase();
  if (v === "required") return "required";
  if (v === "optional") return "optional";
  if (v === "incompatible") return "incompatible";
  if (v === "embedded") return "embedded";
  return "unknown";
}

// get version loader version for mcversion in server creation
async function fetchCompatibleModrinthVersions(args: {
  projectId: string;
  loader: string;
  mcVersion: string;
}) {
  const normalizedLoader = normalizeLoaderForModrinth(args.loader);

  const versionsUrl =
    `https://api.modrinth.com/v2/project/${args.projectId}/version?` +
    new URLSearchParams({
      loaders: JSON.stringify([normalizedLoader]),
      game_versions: JSON.stringify([args.mcVersion]),
    }).toString();

  const res = await fetch(versionsUrl, { headers: getModrinthHeaders() });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch versions for ${args.projectId}: ${res.status} ${res.statusText}${text ? ` ${text}` : ""}`
    );
  }

  const versions: any[] = await res.json();
  return Array.isArray(versions) ? versions : [];
}


function pickPrimaryVersionFile(version: any) {
  return version?.files?.find((f: any) => f.primary) || version?.files?.[0] || null;
}

// get mods 
async function fetchModrinthProject(projectId: string) {
  const res = await fetch(`https://api.modrinth.com/v2/project/${projectId}`, {
    headers: getModrinthHeaders(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch project ${projectId}: ${res.status} ${res.statusText}${text ? ` ${text}` : ""}`
    );
  }

  return await res.json();
}


async function buildModInstallPreview(args: {
  projectId: string;
  loader: string;
  mcVersion: string;
  installedProjectIds?: string[];
}): Promise<ModInstallPreview> {
  const { projectId, loader, mcVersion } = args;
  const installedProjectIds = new Set((args.installedProjectIds || []).filter(Boolean));

  const versions = await fetchCompatibleModrinthVersions({
    projectId,
    loader,
    mcVersion,
  });

  if (!versions.length) {
    throw new Error("No compatible mod version found.");
  }

  const version = versions[0];
  const file = pickPrimaryVersionFile(version);
  if (!file?.filename) {
    throw new Error("No downloadable file found.");
  }

  const projectData = await fetchModrinthProject(projectId);
  const clientSide = (projectData.client_side || "unknown") as ModSideValue;
  const serverSide = (projectData.server_side || "unknown") as ModSideValue;
  const sideSupport = classifyModSide({ clientSide, serverSide });

  const warnings: InstallWarning[] = [];

  if (sideSupport === "client") {
    warnings.push({
      code: "client-only",
      message: `${projectData.title || projectId} looks client-side only.`,
    });
  }

  if (sideSupport === "unknown") {
    warnings.push({
      code: "unknown-side",
      message: `${projectData.title || projectId} has unknown server/client support.`,
    });
  }

  if (installedProjectIds.has(projectId)) {
    warnings.push({
      code: "duplicate-project",
      message: `${projectData.title || projectId} is already installed on this server.`,
    });
  }

  const rawDependencies = Array.isArray(version.dependencies) ? version.dependencies : [];

  const dependencies: ModDependency[] = [];
  for (const dep of rawDependencies) {
    const depType = normalizeDependencyType(dep?.dependency_type);
    const depProjectId = String(dep?.project_id || "").trim();

    if (!depProjectId || depType !== "required") continue;

    const depProject = await fetchModrinthProject(depProjectId);
    const depClientSide = (depProject.client_side || "unknown") as ModSideValue;
    const depServerSide = (depProject.server_side || "unknown") as ModSideValue;

    dependencies.push({
      projectId: depProjectId,
      dependencyType: depType,
      title: depProject.title || depProjectId,
      clientSide: depClientSide,
      serverSide: depServerSide,
      sideSupport: classifyModSide({
        clientSide: depClientSide,
        serverSide: depServerSide,
      }),
      alreadyInstalled: installedProjectIds.has(depProjectId),
    });
  }

  if (dependencies.some((d) => !d.alreadyInstalled)) {
    warnings.push({
      code: "missing-required-dependencies",
      message: "This mod requires additional dependencies.",
    });
  }

  return {
    success: true,
    project: {
      provider: "modrinth",
      projectId,
      title: projectData.title || "Unknown",
      versionId: version.id,
      versionNumber: version.version_number || "",
      fileName: file.filename,
      clientSide,
      serverSide,
      sideSupport,
    },
    dependencies,
    warnings,
  };
}

// uploads mod to drive from: folder/api call
async function uploadModFileToDrive(args: {
  accessToken: string;
  serverId: string;
  loader: string;
  fileName: string;
  fileBuffer: Buffer;
}) {
  const drive = createDriveClient(args.accessToken);

  const serverRootId = await ensureDriveFolderPath({
    accessToken: args.accessToken,
    serverId: args.serverId,
    loader: args.loader,
  });

  const modsFolderId = await getOrCreateChildFolderId(drive, serverRootId, "mods");

  const existing = await drive.files.list({
    q: `'${modsFolderId}' in parents and name='${args.fileName.replace(/'/g, "\\'")}' and trashed=false`,
    fields: "files(id)",
  });

  for (const old of existing.data.files ?? []) {
    await drive.files.delete({ fileId: old.id! });
  }

  const uploaded = await drive.files.create({
    requestBody: {
      name: args.fileName,
      parents: [modsFolderId],
    },
    media: {
      mimeType: "application/java-archive",
      body: Readable.from(args.fileBuffer),
    },
    fields: "id, name, size, createdTime",
  });

  if (!uploaded.data.id || !uploaded.data.name) {
    throw new Error(`Failed to upload ${args.fileName}`);
  }

  return uploaded.data;
}

// download choosen modrinth api file for (compatible with server params)
async function installSingleModrinthProject(args: {
  projectId: string;
  accessToken: string;
  serverId: string;
  loader: string;
  mcVersion: string;
}) {
  // compatibility checked
  const versions = await fetchCompatibleModrinthVersions({
    projectId: args.projectId,
    loader: args.loader,
    mcVersion: args.mcVersion,
  });

  if (!versions.length) {
    throw new Error(`No compatible version found for dependency ${args.projectId}`);
  }

  const version = versions[0];
  const file = pickPrimaryVersionFile(version);
  if (!file?.url) {
    throw new Error(`No downloadable file found for ${args.projectId}`);
  }

  const fileBuffer = await downloadFileToBuffer(file.url);
  const fileName = file.filename || `${args.projectId}.jar`;

  const uploaded = await uploadModFileToDrive({
    accessToken: args.accessToken,
    serverId: args.serverId,
    loader: args.loader,
    fileName,
    fileBuffer,
  });

  const projectData = await fetchModrinthProject(args.projectId);
  const clientSide = (projectData.client_side || "unknown") as ModSideValue;
  const serverSide = (projectData.server_side || "unknown") as ModSideValue;

  return {
    provider: "modrinth" as const,
    projectId: args.projectId,
    title: projectData.title || "Unknown",
    versionId: version.id,
    versionNumber: version.version_number || "",
    file: {
      id: uploaded.id!,
      name: uploaded.name!,
      size: uploaded.size,
      createdTime: uploaded.createdTime,
    },
    clientSide,
    serverSide,
    sideSupport: classifyModSide({ clientSide, serverSide }),
  };
}


async function applyServerSettingsOverride(args: {
  serverDir: string;
  serverSettingsOverride?: Record<string, any>;
  port?: number | null;
}) {
  const { serverDir, serverSettingsOverride, port } = args;

  if (!serverSettingsOverride) {
    if (typeof port === "number") {
      await writeServerPropertiesFile(serverDir, {
        "server-port": String(port),
      });
    }
    return;
  }

  const updates: Record<string, string> = {
    "motd": String(serverSettingsOverride.motd ?? "A Minecraft Server"),
    "level-name": String(serverSettingsOverride.levelName ?? "world"),
    "gamemode": String(serverSettingsOverride.gamemode ?? "survival"),
    "difficulty": String(serverSettingsOverride.difficulty ?? "easy"),
    "pvp": String(!!serverSettingsOverride.pvp),
    "hardcore": String(!!serverSettingsOverride.hardcore),
    "allow-flight": String(!!serverSettingsOverride.allowFlight),
    "max-players": String(serverSettingsOverride.maxPlayers ?? 20),
    "online-mode": String(!!serverSettingsOverride.onlineMode),
    "white-list": String(!!serverSettingsOverride.whiteList),
    "enforce-whitelist": String(!!serverSettingsOverride.enforceWhitelist),
    "enable-command-block": String(!!serverSettingsOverride.enableCommandBlock),
    "allow-nether": String(!!serverSettingsOverride.allowNether),
    "enable-status": String(!!serverSettingsOverride.enableStatus),
    "enable-rcon": String(!!serverSettingsOverride.enableRcon),
    "rcon.password": String(serverSettingsOverride.rconPassword ?? ""),
    "resource-pack": String(serverSettingsOverride.resourcePack ?? ""),
    "view-distance": String(serverSettingsOverride.viewDistance ?? 10),
    "max-world-size": String(serverSettingsOverride.maxWorldSize ?? 10000),
    "spawn-protection": String(serverSettingsOverride.spawnProtection ?? 16),
    "sync-chunk-writes": String(serverSettingsOverride.syncChunkWrites ?? true),
    "enable-query": "false",
  };

  if (typeof port === "number") {
    updates["server-port"] = String(port);
  }

  await writeServerPropertiesFile(serverDir, updates);
}

// ipc handler for loading mod information from modrinth/curse-forge api
ipcMain.handle("preview-mod-install", async (_event, args) => {
  try {
    const { provider, projectId, loader, mcVersion, installedProjectIds } = args ?? {};

    if (provider !== "modrinth") {
      return {
        success: false,
        error: "Only Modrinth is implemented right now.",
      };
    }

    if (!projectId || !loader || !mcVersion) {
      throw new Error("Missing parameters for preview-mod-install.");
    }

    return await buildModInstallPreview({
      projectId,
      loader,
      mcVersion,
      installedProjectIds: Array.isArray(installedProjectIds) ? installedProjectIds : [],
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("search-mods", async (_event, args) => {
  try {
    // 1. Added `isModpack` to the arguments
    const { provider, query, loader, mcVersion, isModpack } = args ?? {};
    const trimmedQuery = String(query || "").trim();
    const normalizedMcVersion = String(mcVersion || "").trim();

    if (!trimmedQuery) {
      return { success: true, results: [] };
    }

    // --- MODRINTH SEARCH LOGIC ---
    if (provider === "modrinth") {
      const normalizedLoader = normalizeLoaderForModrinth(String(loader || ""));

      // 2. Dynamically switch between searching for Mods vs Modpacks
      const targetType = isModpack ? "modpack" : "mod";
      const facets: string[][] = [[`project_type:${targetType}`]];

      // We only apply version/loader filters if we are NOT searching for a modpack
      if (!isModpack) {
        if (normalizedLoader) facets.push([`categories:${normalizedLoader}`]);
        if (normalizedMcVersion) facets.push([`versions:${normalizedMcVersion}`]);
      }

      const url = `https://api.modrinth.com/v2/search?` +
        new URLSearchParams({
          query: trimmedQuery,
          limit: "20",
          index: "relevance",
          facets: JSON.stringify(facets),
        }).toString();

      const res = await fetch(url, { headers: getModrinthHeaders() });
      if (!res.ok) throw new Error(`Modrinth search failed: ${res.status}`);

      const data = await res.json();
      const hits = Array.isArray(data?.hits) ? data.hits : [];

      const results = hits.map((hit: any) => ({
        id: hit.project_id || hit.slug,
        provider: "modrinth",
        projectId: hit.project_id,
        slug: hit.slug,
        title: hit.title || "Untitled",
        description: hit.description || "",
        iconUrl: hit.icon_url || undefined,
        downloads: typeof hit.downloads === "number" ? hit.downloads : undefined,
        loaders: Array.isArray(hit.display_categories) ? hit.display_categories : [],
        gameVersions: Array.isArray(hit.versions) ? hit.versions : [],
      }));

      return { success: true, results };
    }

    // --- CURSEFORGE SEARCH LOGIC ---
    if (provider === "curseforge") {
      const CURSEFORGE_API_KEY = process.env.CURSEFORGE_API_KEY;

      let modLoaderType = 0;
      const lowerLoader = String(loader || "").toLowerCase();
      if (lowerLoader === "forge") modLoaderType = 1;
      else if (lowerLoader === "fabric") modLoaderType = 4;
      else if (lowerLoader === "quilt") modLoaderType = 5;
      else if (lowerLoader === "neoforge") modLoaderType = 6;

      const cfUrl = new URL("https://api.curseforge.com/v1/mods/search");
      cfUrl.searchParams.set("gameId", "432");

      // 3. Dynamically switch CurseForge Class ID (6 = Mods, 4471 = Modpacks)
      const targetClassId = isModpack ? "4471" : "6";
      cfUrl.searchParams.set("classId", targetClassId);

      cfUrl.searchParams.set("searchFilter", trimmedQuery);

      cfUrl.searchParams.set("sortField", "2"); // 2 means sort by Popularity
      cfUrl.searchParams.set("sortOrder", "desc"); // Put the highest numbers at the top

      if (!isModpack) {
        if (normalizedMcVersion) cfUrl.searchParams.set("gameVersion", normalizedMcVersion);
        if (modLoaderType > 0) cfUrl.searchParams.set("modLoaderType", String(modLoaderType));
      }

      if (!CURSEFORGE_API_KEY) {
        throw new Error("Missing environment variable: CURSEFORGE_API_KEY (set it in your .env)");
      }

      const res = await fetch(cfUrl.toString(), {
        headers: {
          Accept: "application/json",
          "x-api-key": CURSEFORGE_API_KEY,
          "User-Agent": "MC_Manager_App/1.0",
        },
      });



      if (!res.ok) throw new Error(`CurseForge search failed: ${res.status}`);

      const data = await res.json();

      const results = (data.data || []).map((mod: any) => ({
        id: String(mod.id),
        provider: "curseforge",
        projectId: String(mod.id),
        slug: mod.slug,
        title: mod.name,
        description: mod.summary,
        iconUrl: mod.logo?.thumbnailUrl || undefined,
        downloads: mod.downloadCount,
        loaders: isModpack ? [] : [lowerLoader],
        gameVersions: [],
      }));

      return { success: true, results };
    }

    return { success: false, error: "Unknown provider", results: [] };

  } catch (error) {
    console.error("Failed to search:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      results: [],
    };
  }
});

ipcMain.handle("get-modpack-metadata", async (event, args: { modpackId: string; provider: string }) => {
  const { modpackId, provider } = args;
  const safeProvider = String(provider || "").toLowerCase();

  try {
    if (safeProvider === "modrinth") {
      console.log(`[Meta] Fetching Modrinth metadata for ${modpackId}...`);
      const packRes = await axios.get(`https://api.modrinth.com/v2/project/${modpackId}/version`);
      const latestVersion = packRes.data[0];
      
      // 1. Prioritize finding an actual .mrpack file, fallback to primary
      const targetFile = latestVersion.files.find((f: any) => f.filename.endsWith('.mrpack')) 
                      || latestVersion.files.find((f: any) => f.primary) 
                      || latestVersion.files[0];

      // 2. Setup safe API fallbacks just in case the zip fails!
      let mcVersion = latestVersion.game_versions?.[0] || "";
      let loader = latestVersion.loaders?.[0] || "vanilla";
      let loaderVersion = "";

      try {
        const tempZipPath = path.join(app.getPath("temp"), `meta-${Date.now()}.mrpack`);
        const tempExtPath = path.join(app.getPath("temp"), `meta-ext-${Date.now()}`);

        const writer = fs.createWriteStream(tempZipPath);
        const zipRes = await axios({ url: targetFile.url, method: 'GET', responseType: 'stream' });
        zipRes.data.pipe(writer);
        
        // Use 'close' instead of 'finish' to prevent OS race conditions
        await new Promise((resolve, reject) => { 
          writer.on('close', resolve); 
          writer.on('error', reject); 
        });

        await fs.createReadStream(tempZipPath).pipe(unzipper.Extract({ path: tempExtPath })).promise();
        
        // Add a tiny 100ms buffer to ensure Windows has written the file
        await new Promise(res => setTimeout(res, 100));

        const manifestPath = path.join(tempExtPath, "modrinth.index.json");
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          const deps = manifest.dependencies;
          
          if (deps.minecraft) mcVersion = deps.minecraft;
          if (deps["fabric-loader"]) { loader = "fabric"; loaderVersion = deps["fabric-loader"]; }
          else if (deps.forge) { loader = "forge"; loaderVersion = deps.forge; }
          else if (deps.neoforge) { loader = "neoforge"; loaderVersion = deps.neoforge; }
          else if (deps["quilt-loader"]) { loader = "quilt"; loaderVersion = deps["quilt-loader"]; }
        }

        fs.rmSync(tempZipPath, { force: true });
        fs.rmSync(tempExtPath, { recursive: true, force: true });

      } catch (zipErr: any) {
        console.warn(`[Meta] .mrpack extraction failed, falling back to API data: ${zipErr.message}`);
      }

      return { success: true, mcVersion, loader, loaderVersion };
    } 
    else if (safeProvider === "curseforge") {
      console.log(`[Meta] Fetching CurseForge metadata for ${modpackId}...`);
      const cfHeaders = { "x-api-key": process.env.CURSEFORGE_API_KEY, "Accept": "application/json" };
      const packRes = await axios.get(`https://api.curseforge.com/v1/mods/${modpackId}`, { headers: cfHeaders });
      const modData = packRes.data.data;
      const fileId = modData.mainFileId || modData.latestFiles[0]?.id;

      let downloadUrl = null;
      try {
        const dlRes = await axios.get(`https://api.curseforge.com/v1/mods/${modpackId}/files/${fileId}/download-url`, { headers: cfHeaders });
        downloadUrl = dlRes.data.data;
      } catch (err) {
        downloadUrl = modData.latestFiles.find((f: any) => f.id === fileId)?.downloadUrl;
      }

      let mcVersion = "";
      let loader = "vanilla";
      let loaderVersion = "";

      try {
        const tempZipPath = path.join(app.getPath("temp"), `meta-${Date.now()}.zip`);
        const tempExtPath = path.join(app.getPath("temp"), `meta-ext-${Date.now()}`);

        const writer = fs.createWriteStream(tempZipPath);
        const zipRes = await axios({ url: downloadUrl, method: 'GET', responseType: 'stream' });
        zipRes.data.pipe(writer);
        
        await new Promise((resolve, reject) => { 
          writer.on('close', resolve); 
          writer.on('error', reject); 
        });

        await fs.createReadStream(tempZipPath).pipe(unzipper.Extract({ path: tempExtPath })).promise();
        await new Promise(res => setTimeout(res, 100));

        const manifestPath = path.join(tempExtPath, "manifest.json");
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          mcVersion = manifest.minecraft.version;
          const loaderObj = manifest.minecraft.modLoaders.find((l: any) => l.primary) || manifest.minecraft.modLoaders[0];
          
          if (loaderObj && loaderObj.id) {
            const parts = loaderObj.id.split("-");
            loader = parts[0]; 
            loaderVersion = parts[1]; 
          }
        }

        fs.rmSync(tempZipPath, { force: true });
        fs.rmSync(tempExtPath, { recursive: true, force: true });
      } catch (zipErr: any) {
        console.warn(`[Meta] CurseForge extraction failed: ${zipErr.message}`);
      }

      return { success: true, mcVersion, loader, loaderVersion };
    }
  } catch (error: any) {
    console.error("[Meta] Critical Error fetching metadata:", error);
    return { success: false, error: error.message };
  }
});

/**
 * Recursively walks a local directory and mirrors it perfectly to Google Drive.
 */
/**
 * Maps the directory structure on Drive and collects all files into a giant list.
 */
async function mapFoldersAndCollectFiles(localPath: string, driveParentId: string, accessToken: string, jobsArray: any[]) {
  const items = fs.readdirSync(localPath);

  for (const item of items) {
    const itemPath = path.join(localPath, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory()) {
      // It's a folder: Create it on Drive right now
      const newFolderId = await getOrCreateFolder(item, driveParentId, accessToken);
      // Dive into it
      await mapFoldersAndCollectFiles(itemPath, newFolderId, accessToken, jobsArray);
    } else {
      // It's a file: Don't upload it yet! Just add it to our swarm queue.
      jobsArray.push({
        localPath: itemPath,
        fileName: item,
        driveParentId: driveParentId
      });
    }
  }
}

/**
 * Unleashes a concurrent swarm of uploads (e.g., 15 at a time)
 */
async function uploadSwarm(jobs: any[], concurrency: number, accessToken: string) {
  let completed = 0;
  const pool = new Set<Promise<void>>();

  for (const job of jobs) {
    const promise = uploadResumableToDrive({
      accessToken,
      filePath: job.localPath,
      fileName: job.fileName,
      parentId: job.driveParentId,
      onProgress: () => {} // Silence the individual progress spam
    }).then(() => {
      completed++;
      // Log progress every 50 files so we don't lag the terminal
      if (completed % 50 === 0 || completed === jobs.length) {
        console.log(`[Provision] Fast Upload: ${completed} / ${jobs.length} files complete...`);
      }
    }).catch(err => {
      console.error(`[Provision] Failed to upload ${job.fileName}:`, err.message);
    }).finally(() => {
      pool.delete(promise);
    });

    pool.add(promise);

    // If our pool hits the concurrency limit (e.g. 15), wait for one to finish before adding another
    if (pool.size >= concurrency) {
      await Promise.race(pool);
    }
  }

  // Wait for the very last batch to finish
  await Promise.all(pool);
}

ipcMain.handle("provision-modpack", async (event, args: { 
  serverId: string; 
  modpackId: string; 
  provider: string;
  accessToken: string;
  driveFolderId: string; // The root Drive folder for this server
}) => {
  const { serverId, modpackId, provider, accessToken, driveFolderId } = args;
  const safeProvider = String(provider || "").toLowerCase();
  
  // 1. Setup Hidden Temp Folders
  const tempServerPath = path.join(app.getPath("temp"), `provision-${serverId}`);
  const modsFolder = path.join(tempServerPath, "mods");
  
  try {
    if (fs.existsSync(tempServerPath)) fs.rmSync(tempServerPath, { recursive: true, force: true });
    fs.mkdirSync(modsFolder, { recursive: true });

    // ==========================================
    // PHASE 1: DOWNLOAD & EXTRACT MODPACK
    // ==========================================
    if (safeProvider === "curseforge") {
      console.log(`[Provision] Starting CurseForge download for ${modpackId}...`);
      const cfHeaders = { "x-api-key": process.env.CURSEFORGE_API_KEY, "Accept": "application/json" };
      
      const packRes = await axios.get(`https://api.curseforge.com/v1/mods/${modpackId}`, { headers: cfHeaders });
      const modData = packRes.data.data;
      const fileId = modData.mainFileId || modData.latestFiles[0]?.id;
      
      let downloadUrl = null;
      try {
        const dlRes = await axios.get(`https://api.curseforge.com/v1/mods/${modpackId}/files/${fileId}/download-url`, { headers: cfHeaders });
        downloadUrl = dlRes.data.data;
      } catch (err) {
        downloadUrl = modData.latestFiles.find((f: any) => f.id === fileId)?.downloadUrl;
      }

      if (!downloadUrl) throw new Error("No download URL found for CurseForge pack!");

      const packZipPath = path.join(app.getPath("temp"), `pack-${Date.now()}.zip`);
      const packExtractPath = path.join(app.getPath("temp"), `ext-${Date.now()}`);

      console.log("[Provision] Downloading and Extracting zip...");
      const writer = fs.createWriteStream(packZipPath);
      const zipRes = await axios({ url: downloadUrl, method: 'GET', responseType: 'stream' });
      zipRes.data.pipe(writer);
      
      // FIX 1: Wait for actual OS file close
      await new Promise((resolve, reject) => { 
        writer.on('close', resolve); 
        writer.on('error', reject); 
      });

      await fs.createReadStream(packZipPath).pipe(unzipper.Extract({ path: packExtractPath })).promise();
      
      // FIX 2: Buffer for Windows file system
      await new Promise(res => setTimeout(res, 100));

      const manifestPath = path.join(packExtractPath, "manifest.json");
      if (!fs.existsSync(manifestPath)) throw new Error("manifest.json missing from CurseForge zip!");
      
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      
      console.log(`[Provision] Fetching ${manifest.files?.length || 0} mods...`);
      for (const file of manifest.files || []) {
        try {
          const fileRes = await axios.get(`https://api.curseforge.com/v1/mods/${file.projectID}/files/${file.fileID}/download-url`, { headers: cfHeaders });
          if (fileRes.data.data) {
            const modName = fileRes.data.data.split('/').pop() || `mod-${file.fileID}.jar`;
            const modWriter = fs.createWriteStream(path.join(modsFolder, modName));
            const modStreamRes = await axios({ url: fileRes.data.data, method: 'GET', responseType: 'stream' });
            modStreamRes.data.pipe(modWriter);
            await new Promise(resolve => modWriter.on('finish', resolve)); // Individual mod jars are okay on 'finish'
          }
        } catch (err) {
          console.error(`[Provision] Skipping blocked mod ID ${file.projectID}`);
        }
      }

      const overridesPath = path.join(packExtractPath, manifest.overrides || "overrides");
      if (fs.existsSync(overridesPath)) fs.cpSync(overridesPath, tempServerPath, { recursive: true });

      fs.rmSync(packZipPath, { force: true });
      fs.rmSync(packExtractPath, { recursive: true, force: true });

    } else if (safeProvider === "modrinth") {
      console.log(`[Provision] Starting Modrinth download for ${modpackId}...`);
      const packRes = await axios.get(`https://api.modrinth.com/v2/project/${modpackId}/version`);
      const latestVersion = packRes.data[0];
      
      // FIX 3: Prioritize .mrpack files so we don't accidentally download a Server Zip!
      const targetFile = latestVersion.files.find((f: any) => f.filename.endsWith('.mrpack')) 
                      || latestVersion.files.find((f: any) => f.primary) 
                      || latestVersion.files[0];

      const packZipPath = path.join(app.getPath("temp"), `pack-${Date.now()}.mrpack`);
      const packExtractPath = path.join(app.getPath("temp"), `ext-${Date.now()}`);

      console.log("[Provision] Downloading and Extracting .mrpack...");
      const writer = fs.createWriteStream(packZipPath);
      const zipRes = await axios({ url: targetFile.url, method: 'GET', responseType: 'stream' });
      zipRes.data.pipe(writer);
      
      // FIX 1: OS Close
      await new Promise((resolve, reject) => { 
        writer.on('close', resolve); 
        writer.on('error', reject); 
      });

      await fs.createReadStream(packZipPath).pipe(unzipper.Extract({ path: packExtractPath })).promise();
      
      // FIX 2: Buffer
      await new Promise(res => setTimeout(res, 100));

      const manifestPath = path.join(packExtractPath, "modrinth.index.json");
      if (!fs.existsSync(manifestPath)) throw new Error(`modrinth.index.json missing! Downloaded: ${targetFile.filename}`);
      
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      console.log(`[Provision] Fetching ${manifest.files?.length || 0} mods...`);
      for (const file of manifest.files || []) {
        const downloadUrl = file.downloads[0];
        if (downloadUrl) {
          const fileDest = path.join(tempServerPath, file.path);
          const dir = path.dirname(fileDest);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          const modWriter = fs.createWriteStream(fileDest);
          const modStreamRes = await axios({ url: downloadUrl, method: 'GET', responseType: 'stream' });
          modStreamRes.data.pipe(modWriter);
          await new Promise(resolve => modWriter.on('finish', resolve));
        }
      }

      const overridesPath = path.join(packExtractPath, "overrides");
      if (fs.existsSync(overridesPath)) fs.cpSync(overridesPath, tempServerPath, { recursive: true });

      fs.rmSync(packZipPath, { force: true });
      fs.rmSync(packExtractPath, { recursive: true, force: true });

    } else {
      throw new Error(`Unknown provider: '${provider}'`);
    }

    // ==========================================
    // PHASE 2: RECURSIVE MIRROR TO GOOGLE DRIVE
    // ==========================================
    console.log("[Provision] Modpack built locally. Mapping Drive Folders...");
    const uploadJobs: any[] = [];
    
    // mapFoldersAndCollectFiles and uploadSwarm should still be in your file from earlier!
    await mapFoldersAndCollectFiles(tempServerPath, driveFolderId, accessToken, uploadJobs);

    console.log(`[Provision] Folder map complete. Unleashing swarm upload for ${uploadJobs.length} files...`);
    await uploadSwarm(uploadJobs, 15, accessToken);

    // ==========================================
    // PHASE 3: CLEANUP
    // ==========================================
    console.log("[Provision] Cleaning up temp provision folder...");
    fs.rmSync(tempServerPath, { recursive: true, force: true });

    console.log("[Provision] Modpack Successfully Provisioned to Drive!");
    return { success: true };
    
  } catch (error: any) {
    console.error("[Provision] Error:", error);
    if (fs.existsSync(tempServerPath)) fs.rmSync(tempServerPath, { recursive: true, force: true });
    return { success: false, error: error.message };
  }
});

ipcMain.removeHandler("install-discovered-mod");

// handler for uploading chosen mod from search to drive
ipcMain.handle("install-discovered-mod", async (_event, args) => {
  try {
    const {
      provider,
      projectId,
      serverId,
      loader,
      mcVersion,
      accessToken,
      installedProjectIds,
      installDependencyProjectIds,
      replaceExistingProjectIds,
    } = args ?? {};

    if (provider !== "modrinth") {
      return {
        success: false,
        error: "Only Modrinth is implemented right now.",
      };
    }

    const missing: string[] = [];
    if (!projectId) missing.push("projectId");
    if (!serverId) missing.push("serverId");
    if (!loader) missing.push("loader");
    if (!mcVersion) missing.push("mcVersion");
    if (!accessToken) missing.push("accessToken");

    if (missing.length > 0) {
      throw new Error(`Missing parameters for install-discovered-mod: ${missing.join(", ")}`);
    }

    const installedSet = new Set<string>(
      Array.isArray(installedProjectIds) ? installedProjectIds.filter(Boolean) : []
    );
    const replaceSet = new Set<string>(
      Array.isArray(replaceExistingProjectIds) ? replaceExistingProjectIds.filter(Boolean) : []
    );
    const dependencySet = new Set<string>(
      Array.isArray(installDependencyProjectIds) ? installDependencyProjectIds.filter(Boolean) : []
    );

    const preview = await buildModInstallPreview({
      projectId,
      loader,
      mcVersion,
      installedProjectIds: Array.from(installedSet),
    });

    if (!preview.success || !preview.project) {
      throw new Error(preview.error || "Failed to prepare install preview.");
    }

    if (installedSet.has(projectId) && !replaceSet.has(projectId)) {
      throw new Error("That mod project is already installed.");
    }

    const requiredMissingDeps = (preview.dependencies || []).filter(
      (dep) => dep.dependencyType === "required" && !dep.alreadyInstalled
    );

    for (const dep of requiredMissingDeps) {
      if (!dependencySet.has(dep.projectId)) {
        throw new Error(`Missing required dependency selection: ${dep.title}`);
      }
    }

    const installed: Array<{
      provider: "modrinth";
      projectId: string;
      title: string;
      versionId: string;
      versionNumber?: string;
      clientSide: ModSideValue;
      serverSide: ModSideValue;
      sideSupport: ModSideSupport;
      file: {
        id: string;
        name: string;
        size?: string | null;
        createdTime?: string | null;
      };
      isDependency?: boolean;
    }> = [];

    for (const dep of requiredMissingDeps) {
      const depInstalled = await installSingleModrinthProject({
        projectId: dep.projectId,
        accessToken,
        serverId,
        loader,
        mcVersion,
      });

      installed.push({
        ...depInstalled,
        isDependency: true,
      });
    }

    const mainInstalled = await installSingleModrinthProject({
      projectId,
      accessToken,
      serverId,
      loader,
      mcVersion,
    });

    installed.push({
      ...mainInstalled,
      isDependency: false,
    });

    const mainProject = installed.find((item) => !item.isDependency)!;

    return {
      success: true,
      project: {
        provider: mainProject.provider,
        projectId: mainProject.projectId,
        title: mainProject.title,
        versionId: mainProject.versionId,
        versionNumber: mainProject.versionNumber,
        clientSide: mainProject.clientSide,
        serverSide: mainProject.serverSide,
        sideSupport: mainProject.sideSupport,
      },
      file: mainProject.file,
      installed,
    };
  } catch (error) {
    console.error("Failed to install discovered mod:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// reads server properties file for input base value
ipcMain.handle("read-importable-server-properties", async (_event, args) => {
  try {
    const { sourceServerPath } = args ?? {};

    if (!sourceServerPath || typeof sourceServerPath !== "string") {
      throw new Error("Missing sourceServerPath for read-importable-server-properties.");
    }

    const propsPath = path.join(sourceServerPath, "server.properties");
    const exists = await pathExists(propsPath);

    if (!exists) {
      return {
        success: true,
        found: false,
        data: null,
      };
    }

    const raw = await fs.promises.readFile(propsPath, "utf8");
    const data = extractImportableServerSettingsFromProperties(raw);

    return {
      success: true,
      found: true,
      data,
    };
  } catch (error) {
    console.error("Failed to read importable server properties:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      found: false,
      data: null,
    };
  }
});

// finding children folders (multi tool) for listing
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

// creating child folder in ?drive
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

// downloading drive file (retry implemented) const 3
async function downloadDriveFileToPathWithRetry(args: {
  drive: any;
  fileId: string;
  targetPath: string;
  attempts?: number;
}) {
  const { drive, fileId, targetPath, attempts = 3 } = args;

  let lastError: any = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await downloadDriveFileToPath({
        drive,
        fileId,
        targetPath,
      });
      return;
    } catch (error) {
      lastError = error;
      console.warn(
        `[mc-server-manager] Drive download failed for ${fileId} (attempt ${attempt}/${attempts})`,
        error
      );

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
      }
    }
  }

  throw lastError;
}

// non retry download from drive (old)
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

async function getLocalFileMD5(filePath: string): Promise<string | null> {
  try {
    await fs.promises.access(filePath); // Létezik egyáltalán?
    return await new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);
      stream.on("error", (err) => reject(err));
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  } catch {
    return null; // Ha nincs meg a fájl, null-t ad vissza
  }
}

// recursive folder donwload (full) ready for both paralel and queue
async function downloadDriveFolderRecursive(args: {
  drive: any;
  folderId: string;
  localDestination: string;
}) {
  const { drive, folderId, localDestination } = args;

  await fs.promises.mkdir(localDestination, { recursive: true });

  // ÚJÍTÁS: Itt lekérjük az 'md5Checksum'-ot is a Drive-ról!
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id, name, mimeType, md5Checksum)", 
    pageSize: 1000,
  });

  const files = res.data.files ?? [];

  const folders = files.filter(
    (file: any) => file.mimeType === "application/vnd.google-apps.folder"
  );

  const normalFiles = files.filter(
    (file: any) => file.mimeType !== "application/vnd.google-apps.folder"
  );

  // --- ÚJÍTÁS: LOKÁLIS SZEMÉT TAKARÍTÁSA ---
  // Ha valami van a mappában, ami a Drive-on már nincs, töröljük.
  try {
    const localEntries = await fs.promises.readdir(localDestination, { withFileTypes: true });
    const driveNames = new Set(files.map((f: any) => f.name));

    for (const entry of localEntries) {
      if (!driveNames.has(entry.name)) {
        const absPath = path.join(localDestination, entry.name);
        await fs.promises.rm(absPath, { recursive: true, force: true });
        console.log(`[Smart Sync] Törölve (már nincs a Drive-on): ${entry.name}`);
      }
    }
  } catch (err) {
    // Ignoráljuk, ha a mappa korábban még nem is létezett
  }
  // -----------------------------------------

  await runWithConcurrency(normalFiles, 3, async (file: any) => {
    const targetPath = path.join(localDestination, file.name!);

    // --- ÚJÍTÁS: HASH ELLENŐRZÉS (A varázslat) ---
    const localMD5 = await getLocalFileMD5(targetPath);
    const driveMD5 = file.md5Checksum;

    if (localMD5 && driveMD5 && localMD5 === driveMD5) {
      console.log(`[Smart Sync] Átugorva (Fájl változatlan): ${file.name}`);
      return; // Ha egyezik az ujjlenyomat, KILÉPÜNK. Nem kell letölteni!
    }

    console.log(`[Smart Sync] Letöltés (Új vagy frissült): ${file.name}`);
    // ---------------------------------------------

    await downloadDriveFileToPathWithRetry({
      drive,
      fileId: file.id!,
      targetPath,
      attempts: 3,
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

// child folder seach based on name adn paretn id
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

// vanilla server setup/runtime checks
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

// still not implemented
async function preparePaperRuntime(mcVersion: string, extractPath: string) {
  return { success: false, error: "Paper runtime is not implemented yet." };
}


// fabric server setup
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

  // prefer a stable installer, otherwise fall back to the first one returned
  const chosenInstaller =
    installers.find((entry: any) => entry?.stable === true && entry?.version) ??
    installers.find((entry: any) => entry?.version);

  const installerVersion = chosenInstaller?.version;
  if (!installerVersion) {
    throw new Error("Could not determine a Fabric installer version.");
  }

  // download the Fabric server bootstrap jar
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
  // save as .jar
  const jarPath = path.join(extractPath, "server.jar");
  await fs.promises.writeFile(jarPath, buffer);

  return { success: true };
}

async function downloadFileToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Failed to download ${url}: ${res.status} ${res.statusText}` +
      (errText ? ` - ${errText}` : "")
    );
  }

  return await res.buffer();
}

// you might evene know this if you ar enot retarded
async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}


// finding neccessry files for server start
async function detectForgeLaunch(extractPath: string): Promise<ForgeLaunchInfo | null> {
  const userJvmArgsPath = path.join(extractPath, "user_jvm_args.txt");
  const runBatPath = path.join(extractPath, "run.bat");
  const runShPath = path.join(extractPath, "run.sh");

  const hasUserJvmArgs = await fileExists(userJvmArgsPath);

  const forgeLibrariesRoot = path.join(
    extractPath,
    "libraries",
    "net",
    "minecraftforge",
    "forge"
  );

  const forgeVersionDirStat = await fs.promises.stat(forgeLibrariesRoot).catch(() => null);

  if (hasUserJvmArgs && forgeVersionDirStat?.isDirectory()) {
    const forgeVersionDirs = await fs.promises.readdir(forgeLibrariesRoot, {
      withFileTypes: true,
    });

    for (const dir of forgeVersionDirs) {
      if (!dir.isDirectory()) continue;

      const candidateBase = path.join(forgeLibrariesRoot, dir.name);
      const winArgsPath = path.join(candidateBase, "win_args.txt");
      const unixArgsPath = path.join(candidateBase, "unix_args.txt");

      const hasWinArgs = await fileExists(winArgsPath);
      const hasUnixArgs = await fileExists(unixArgsPath);

      if (hasWinArgs || hasUnixArgs) {
        return {
          mode: "args",
          userJvmArgsPath,
          winArgsPath: hasWinArgs ? winArgsPath : undefined,
          unixArgsPath: hasUnixArgs ? unixArgsPath : undefined,
        };
      }
    }
  }

  const entries = await fs.promises.readdir(extractPath, { withFileTypes: true });
  const preferredNames: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const lower = entry.name.toLowerCase();
    if (!lower.endsWith(".jar")) continue;
    if (lower.includes("installer")) continue;

    if (
      lower.startsWith("forge-") ||
      lower.startsWith("minecraft_server.") ||
      lower.includes("server")
    ) {
      preferredNames.push(path.join(extractPath, entry.name));
    }
  }

  if (preferredNames.length > 0) {
    const forgeJar =
      preferredNames.find((p) => path.basename(p).toLowerCase().startsWith("forge-")) ??
      preferredNames[0];

    return {
      mode: "jar",
      jarPath: forgeJar,
    };
  }

  return null;
}

// installing forge
async function runForgeInstaller(
  installerJarPath: string,
  extractPath: string,
  mcVersion: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const javaExec = resolveJavaExecutable(mcVersion);

  return await new Promise((resolve, reject) => {
    const proc = spawn(
      javaExec,
      ["-jar", installerJarPath, "--installServer"],
      {
        cwd: extractPath,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stderr = "";
    let stdout = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);

    proc.on("close", (code) => {
      resolve({
        code: code ?? null,
        stdout,
        stderr,
      });
    });
  });
}

// get forge loader version from mcversion
ipcMain.handle("get-forge-loader-versions", async (_event, mcVersion: string) => {
  try {
    const normalizedMcVersion = String(mcVersion || "").trim();

    if (!normalizedMcVersion) {
      return { success: true, versions: [] };
    }

    const pageUrl =
      `https://files.minecraftforge.net/net/minecraftforge/forge/index_${encodeURIComponent(normalizedMcVersion)}.html`;

    const res = await fetch(pageUrl);
    if (!res.ok) {
      return {
        success: false,
        error: `Failed to fetch Forge versions for Minecraft ${normalizedMcVersion}: ${res.status} ${res.statusText}`,
        versions: [],
      };
    }

    const html = await res.text();

    // Grab Forge version numbers from installer links like:
    // forge-1.21.10-60.1.9-installer.jar
    const regex = new RegExp(
      `forge-${normalizedMcVersion.replace(/\./g, "\\.")}-([0-9][A-Za-z0-9_.-]*)-installer\\.jar`,
      "g"
    );

    const found = new Set<string>();
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(html)) !== null) {
      if (match[1]) {
        found.add(match[1]);
      }
    }

    const versions = Array.from(found);

    // Sort descending, numeric-aware
    versions.sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" })
    );

    return { success: true, versions };
  } catch (error) {
    console.error("Failed to fetch Forge loader versions:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      versions: [],
    };
  }
});

// neccesary server setup before hosting
async function prepareForgeRuntime(
  mcVersion: string,
  loaderVersion: string,
  extractPath: string
) {
  if (!mcVersion?.trim()) {
    throw new Error("Forge runtime requires a Minecraft version.");
  }

  if (!loaderVersion?.trim()) {
    throw new Error("Forge runtime requires a loader version.");
  }
  const exists = await forgeArtifactExists(mcVersion, loaderVersion);

  if (!exists) {
    throw new Error(
      `Invalid Forge version pair: Minecraft ${mcVersion} is not available with Forge ${loaderVersion}. ` +
      `Pick a Forge build that belongs to that Minecraft version.`
    );
  }
  await fs.promises.mkdir(extractPath, { recursive: true });
  await fs.promises.mkdir(path.join(extractPath, "mods"), { recursive: true });
  await fs.promises.mkdir(path.join(extractPath, "config"), { recursive: true });

  const installerFileName = `forge-${mcVersion}-${loaderVersion}-installer.jar`;
  const installerUrl =
    `https://maven.minecraftforge.net/net/minecraftforge/forge/` +
    `${encodeURIComponent(mcVersion)}-${encodeURIComponent(loaderVersion)}/` +
    `${installerFileName}`;

  const installerJarPath = path.join(extractPath, installerFileName);

  const installerBuffer = await downloadFileToBuffer(installerUrl);
  await fs.promises.writeFile(installerJarPath, installerBuffer);

  const installResult = await runForgeInstaller(installerJarPath, extractPath, mcVersion);

  if (installResult.code !== 0) {
    console.warn(
      "[mc-server-manager] Forge installer exited non-zero, checking for usable runtime anyway.",
      {
        code: installResult.code,
        stdout: installResult.stdout,
        stderr: installResult.stderr,
      }
    );
  }

  const detectedLaunch = await detectForgeLaunch(extractPath);

  if (!detectedLaunch) {
    const rootEntries = await fs.promises.readdir(extractPath).catch(() => []);
    throw new Error(
      "Forge installer completed, but no runnable Forge runtime was detected. " +
      `Root contents: ${rootEntries.join(", ")}`
    );
  }

  const eulaPath = path.join(extractPath, "eula.txt");
  if (!(await fileExists(eulaPath))) {
    await fs.promises.writeFile(eulaPath, "eula=true\n", "utf8");
  }

  if (detectedLaunch.mode === "jar") {
    const normalizedJarPath = path.join(extractPath, "server.jar");

    if (path.resolve(detectedLaunch.jarPath) !== path.resolve(normalizedJarPath)) {
      await fs.promises.copyFile(detectedLaunch.jarPath, normalizedJarPath);
    }

    return {
      success: true,
      launchMode: "jar" as const,
      launcherJar: normalizedJarPath,
      detectedLaunchJar: path.basename(detectedLaunch.jarPath),
    };
  }

  return {
    success: true,
    launchMode: "forge-args" as const,
    userJvmArgsPath: detectedLaunch.userJvmArgsPath,
    winArgsPath: detectedLaunch.winArgsPath ?? null,
    unixArgsPath: detectedLaunch.unixArgsPath ?? null,
  };
}

// downloads the full folder with childs form cloud
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


// selecting existing mc world for new server /mcworld/world
ipcMain.handle("select-world-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
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

// handler for full extraction
ipcMain.handle("import-existing-world", async (_event, args) => {
  try {
    const {
      accessToken,
      serverId,
      loader,
      mcVersion,
      loaderVersion,
      sourceWorldPath,
      extractPath,
      retention = 10,
      port = 25565,
    } = args ?? {};

    if (!accessToken) {
      throw new Error("Missing accessToken for import-existing-world.");
    }

    if (!serverId || typeof serverId !== "string") {
      throw new Error("Missing serverId for import-existing-world.");
    }

    if (!loader || typeof loader !== "string") {
      throw new Error("Missing loader for import-existing-world.");
    }

    if (!mcVersion || typeof mcVersion !== "string") {
      throw new Error("Missing mcVersion for import-existing-world.");
    }

    if (!sourceWorldPath || typeof sourceWorldPath !== "string") {
      throw new Error("Missing sourceWorldPath for import-existing-world.");
    }

    if (!extractPath || typeof extractPath !== "string") {
      throw new Error("Missing extractPath for import-existing-world.");
    }

    const sourceStat = await fs.promises.stat(sourceWorldPath).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory()) {
      throw new Error("Selected world path is not a valid directory.");
    }

    const levelDatPath = path.join(sourceWorldPath, "level.dat");
    if (!(await pathExists(levelDatPath))) {
      throw new Error("Selected folder is not a valid Minecraft world (level.dat missing).");
    }

    await fs.promises.mkdir(extractPath, { recursive: true });

    const runtimeResult = await (async () => {
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
          return await prepareForgeRuntime(mcVersion, loaderVersion || "", extractPath);

        case "neoforge":
          return { success: false, error: "NeoForge runtime is not implemented yet." };

        default:
          return { success: false, error: `Unsupported loader: ${loader}` };
      }
    })();

    if (!runtimeResult?.success) {
      const runtimeError =
        "error" in runtimeResult && typeof runtimeResult.error === "string"
          ? runtimeResult.error
          : "Failed to prepare runtime for imported world.";

      throw new Error(runtimeError);
    }

    const worldTargetPath = path.join(extractPath, "world");
    await ensureEmptyDir(worldTargetPath);
    await copyDirectoryRecursive(sourceWorldPath, worldTargetPath);

    await writeImportedServerProperties({
      serverDir: extractPath,
      levelName: "world",
      port,
    });

    await fs.promises.writeFile(
      path.join(extractPath, "eula.txt"),
      "eula=true\n",
      "utf8"
    );

    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
    });

    const drive = createDriveClient(accessToken);

    const guaranteedFolders = ["mods", "config", "plugins"];
    for (const folderName of guaranteedFolders) {
      await getOrCreateChildFolderId(drive, serverRootId, folderName);
    }

    await backupServerV2({
      serverPath: extractPath,
      serverId,
      accessToken,
      driveBackupFolderId: serverRootId,
      retention,
    });

    return {
      success: true,
      serverId,
      extractPath,
      importedWorldName: path.basename(sourceWorldPath),
      loader,
      mcVersion,
    };
  } catch (error) {
    console.error("Failed to import existing world:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// if you dont understand you a dumb b... basically setting up the server from a previous server
ipcMain.handle("import-existing-server", async (_event, args) => {
  try {
    const {
      accessToken,
      serverId,
      loader,
      mcVersion,
      loaderVersion,
      sourceServerPath,
      extractPath,
      serverSettingsOverride,
      retention = 10,
      port = 25565,
    } = args ?? {};

    if (!accessToken) {
      throw new Error("Missing accessToken for import-existing-server.");
    }

    if (!serverId || typeof serverId !== "string") {
      throw new Error("Missing serverId for import-existing-server.");
    }

    if (!loader || typeof loader !== "string") {
      throw new Error("Missing loader for import-existing-server.");
    }

    if (!mcVersion || typeof mcVersion !== "string") {
      throw new Error("Missing mcVersion for import-existing-server.");
    }

    if (!sourceServerPath || typeof sourceServerPath !== "string") {
      throw new Error("Missing sourceServerPath for import-existing-server.");
    }

    if (!extractPath || typeof extractPath !== "string") {
      throw new Error("Missing extractPath for import-existing-server.");
    }

    const sourceStat = await fs.promises.stat(sourceServerPath).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory()) {
      throw new Error("Selected server path is not a valid directory.");
    }

    await fs.promises.mkdir(extractPath, { recursive: true });

    const runtimeResult = await (async () => {
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
          return await prepareForgeRuntime(mcVersion, loaderVersion || "", extractPath);

        case "neoforge":
          return { success: false, error: "NeoForge runtime is not implemented yet." };

        default:
          return { success: false, error: `Unsupported loader: ${loader}` };
      }
    })();

    if (!runtimeResult?.success) {
      const runtimeError =
        "error" in runtimeResult && typeof runtimeResult.error === "string"
          ? runtimeResult.error
          : "Failed to prepare runtime for imported server.";

      throw new Error(runtimeError);
    }

    const sourceLevelName = await readImportedLevelName(sourceServerPath);

    const worldCandidates = [
      path.join(sourceServerPath, sourceLevelName),
      path.join(sourceServerPath, "world"),
    ];

    let chosenWorldPath: string | null = null;

    for (const candidate of worldCandidates) {
      const stat = await fs.promises.stat(candidate).catch(() => null);
      if (stat?.isDirectory() && (await pathExists(path.join(candidate, "level.dat")))) {
        chosenWorldPath = candidate;
        break;
      }
    }

    if (!chosenWorldPath) {
      throw new Error("Could not find a valid world folder inside the selected server.");
    }

    await ensureEmptyDir(path.join(extractPath, "world"));
    await copyDirectoryRecursive(chosenWorldPath, path.join(extractPath, "world"));

    const netherCandidates = [
      path.join(sourceServerPath, `${sourceLevelName}_nether`),
      path.join(sourceServerPath, "world_nether"),
    ];

    for (const candidate of netherCandidates) {
      const copied = await copyOptionalFolderIfExists(candidate, path.join(extractPath, "world_nether"));
      if (copied) break;
    }

    const endCandidates = [
      path.join(sourceServerPath, `${sourceLevelName}_the_end`),
      path.join(sourceServerPath, "world_the_end"),
    ];

    for (const candidate of endCandidates) {
      const copied = await copyOptionalFolderIfExists(candidate, path.join(extractPath, "world_the_end"));
      if (copied) break;
    }

    await copyOptionalFileIfExists(
      path.join(sourceServerPath, "server.properties"),
      path.join(extractPath, "server.properties")
    );

    await copyOptionalFileIfExists(
      path.join(sourceServerPath, "ops.json"),
      path.join(extractPath, "ops.json")
    );

    await copyOptionalFileIfExists(
      path.join(sourceServerPath, "whitelist.json"),
      path.join(extractPath, "whitelist.json")
    );

    await copyOptionalFileIfExists(
      path.join(sourceServerPath, "banned-ips.json"),
      path.join(extractPath, "banned-ips.json")
    );

    await copyOptionalFileIfExists(
      path.join(sourceServerPath, "banned-players.json"),
      path.join(extractPath, "banned-players.json")
    );

    await copyOptionalFileIfExists(
      path.join(sourceServerPath, "usercache.json"),
      path.join(extractPath, "usercache.json")
    );

    const copiedEula = await copyOptionalFileIfExists(
      path.join(sourceServerPath, "eula.txt"),
      path.join(extractPath, "eula.txt")
    );

    await copyOptionalFileIfExists(
      path.join(sourceServerPath, "server-icon.png"),
      path.join(extractPath, "server-icon.png")
    );

    await writeImportedServerProperties({
      serverDir: extractPath,
      levelName: "world",
      port,
    });

    await applyServerSettingsOverride({
      serverDir: extractPath,
      serverSettingsOverride: {
        ...serverSettingsOverride,
        levelName: "world",
      },
      port,
    });

    if (!copiedEula) {
      await fs.promises.writeFile(
        path.join(extractPath, "eula.txt"),
        "eula=true\n",
        "utf8"
      );
    }

    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
    });

    const drive = createDriveClient(accessToken);

    const modsFolderId = await getOrCreateChildFolderId(drive, serverRootId, "mods");
    const configFolderId = await getOrCreateChildFolderId(drive, serverRootId, "config");
    const pluginsFolderId = await getOrCreateChildFolderId(drive, serverRootId, "plugins");

    const copiedMods = await copyOptionalFolderIfExists(
      path.join(sourceServerPath, "mods"),
      path.join(extractPath, "mods")
    );

    const copiedConfig = await copyOptionalFolderIfExists(
      path.join(sourceServerPath, "config"),
      path.join(extractPath, "config")
    );

    const copiedPlugins = await copyOptionalFolderIfExists(
      path.join(sourceServerPath, "plugins"),
      path.join(extractPath, "plugins")
    );

    if (copiedMods) {
      await uploadLocalFolderToDriveRecursive({
        drive,
        parentFolderId: modsFolderId,
        localSourcePath: path.join(extractPath, "mods"),
      });
    }

    if (copiedConfig) {
      await uploadLocalFolderToDriveRecursive({
        drive,
        parentFolderId: configFolderId,
        localSourcePath: path.join(extractPath, "config"),
      });
    }

    if (copiedPlugins) {
      await uploadLocalFolderToDriveRecursive({
        drive,
        parentFolderId: pluginsFolderId,
        localSourcePath: path.join(extractPath, "plugins"),
      });
    }

    await backupServerV2({
      serverPath: extractPath,
      serverId,
      accessToken,
      driveBackupFolderId: serverRootId,
      retention,
    });

    return {
      success: true,
      serverId,
      extractPath,
      importedServerName: path.basename(sourceServerPath),
      loader,
      mcVersion,
    };
  } catch (error) {
    console.error("Failed to import existing server:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// serverdetails mods upload... rewriten in 1.0.6
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
    await runWithConcurrency(files, 3, async (file: any) => {
      const targetPath = path.join(localDestination, file.name!);

      await downloadDriveFileToPathWithRetry({
        drive,
        fileId: file.id!,
        targetPath,
        attempts: 3,
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

// lists all children
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

// point to point file movement
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

// deleting file with fileId
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

// multi tool handler for runtime 
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
        return await prepareForgeRuntime(mcVersion, loaderVersion || "", extractPath);

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



type RestoreVerificationState =
  | "idle"
  | "queued"
  | "running"
  | "passed"
  | "failed";

type RestoreVerificationStatus = {
  serverId: string;
  state: RestoreVerificationState;
  snapshotId: string | null;
  message: string;
  current: number;
  total: number;
  percent: number;
  checkedFiles?: number;
  verifiedFiles?: number;
  missingFiles?: string[];
  failedFiles?: Array<{
    path: string;
    reason: "size-mismatch" | "hash-mismatch";
    expectedSize?: number;
    actualSize?: number;
    expectedHash?: string;
    actualHash?: string;
  }>;
  startedAt?: number | null;
  finishedAt?: number | null;
};

const restoreVerificationByServer = new Map<string, RestoreVerificationStatus>();
const restoreVerificationJobs = new Map<string, Promise<void>>();


let mainWindow: BrowserWindow | null = null;


const consoleWindows = new Map<string, BrowserWindow>();
const liveAdminWindows = new Map<string, BrowserWindow>();

let metricsWindow: BrowserWindow | null = null;
let ownerWindow: BrowserWindow | null = null;
const onlinePlayersByServer = new Map<string, string[]>();

function getOnlinePlayersSnapshot(serverId: string): string[] {
  return [...(onlinePlayersByServer.get(serverId) ?? [])];
}

function setOnlinePlayersForServer(serverId: string, players: string[]) {
  const unique = Array.from(new Set(players.map((p) => p.trim()).filter(Boolean)));
  onlinePlayersByServer.set(serverId, unique);

  const payload = {
    serverId,
    players: unique,
    count: unique.length,
  };

  const liveAdminWin = liveAdminWindows.get(serverId);
  if (liveAdminWin && !liveAdminWin.isDestroyed()) {
    liveAdminWin.webContents.send("online-players-changed", payload);
  }

  const consoleWin = consoleWindows.get(serverId);
  if (consoleWin && !consoleWin.isDestroyed()) {
    consoleWin.webContents.send("online-players-changed", payload);
  }
}

function addOnlinePlayer(serverId: string, playerName: string) {
  const current = getOnlinePlayersSnapshot(serverId);
  if (!current.includes(playerName)) {
    current.push(playerName);
    setOnlinePlayersForServer(serverId, current);
  }
}

function removeOnlinePlayer(serverId: string, playerName: string) {
  const current = getOnlinePlayersSnapshot(serverId).filter((p) => p !== playerName);
  setOnlinePlayersForServer(serverId, current);
}

function clearOnlinePlayers(serverId: string) {
  setOnlinePlayersForServer(serverId, []);
}


function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getUtilityWindowBounds(
  anchorWindow: BrowserWindow | null,
  options: {
    width: number;
    height: number;
    gap?: number;
  }
) {
  const { width, height, gap = 14 } = options;

  if (!anchorWindow || anchorWindow.isDestroyed()) {
    const display = screen.getPrimaryDisplay().workArea;
    return {
      x: Math.round(display.x + (display.width - width) / 2),
      y: Math.round(display.y + (display.height - height) / 2),
      width,
      height,
    };
  }

  const anchorBounds = anchorWindow.getBounds();
  const workArea = screen.getDisplayMatching(anchorBounds).workArea;

  const rightX = anchorBounds.x + anchorBounds.width + gap;
  const leftX = anchorBounds.x - width - gap;

  const fitsRight = rightX + width <= workArea.x + workArea.width;
  const fitsLeft = leftX >= workArea.x;

  const x = fitsRight
    ? rightX
    : fitsLeft
      ? leftX
      : clamp(
        anchorBounds.x + anchorBounds.width - width,
        workArea.x,
        workArea.x + workArea.width - width
      );

  const y = clamp(
    anchorBounds.y + Math.round((anchorBounds.height - height) / 2),
    workArea.y,
    workArea.y + workArea.height - height
  );

  return { x, y, width, height };
}

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

function emitRestoreVerificationStatus(serverId: string) {
  const status = restoreVerificationByServer.get(serverId);
  if (!status) return;
  sendToRelevantWindows("restore-verification-progress", status, serverId);
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

ipcMain.handle(
  "open-server-live-admin",
  async (_e, { serverId, accessToken }: { serverId: string; accessToken: string }) => {
    const existing = liveAdminWindows.get(serverId);

    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { success: true };
    }

    const preloadPath = !app.isPackaged
      ? path.join(__dirname, "preload.js")
      : path.join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "preload.js");

    const relatedConsole = consoleWindows.get(serverId) ?? null;

    const bounds = getUtilityWindowBounds(relatedConsole, {
      width: 470,
      height: 620,
      gap: 14,
    });

    const liveAdminWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: 400,
      minHeight: 460,
      maxWidth: 620,
      autoHideMenuBar: true,
      backgroundColor: "#0b0b0b",
      title: `Live Admin - ${serverId}`,
      resizable: true,
      useContentSize: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    liveAdminWindows.set(serverId, liveAdminWindow);

    liveAdminWindow.on("closed", () => {
      liveAdminWindows.delete(serverId);
    });

    const params = new URLSearchParams();
    params.set("serverId", serverId);
    params.set("accessToken", accessToken);

    await liveAdminWindow.loadURL(getRendererUrl(`/live-admin?${params.toString()}`));

    return { success: true };
  }
);

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
  const { serverPath, serverId, loader, accessToken, retention, driveFolderId, isModpack } = args;

  try {
    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
      driveFolderId,  
      isModpack,      
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

ipcMain.handle(
  "start-restore-verification",
  async (_event, { snapshotId, serverPath, serverId, loader, accessToken, driveFolderId, isModpack }: any) => {
    try {
      const existingJob = restoreVerificationJobs.get(serverId);
      if (existingJob) {
        return { success: true, alreadyRunning: true };
      }

      const queuedStatus: RestoreVerificationStatus = {
        serverId,
        state: "queued",
        snapshotId,
        message: "Restore check queued",
        current: 0,
        total: 1,
        percent: 0,
        startedAt: Date.now(),
        finishedAt: null,
      };

      restoreVerificationByServer.set(serverId, queuedStatus);
      emitRestoreVerificationStatus(serverId);

      const job = (async () => {
        try {
          const drive = createDriveClient(accessToken);

          const serverRootId = await ensureDriveFolderPath({
            accessToken,
            serverId,
            loader,
            driveFolderId,  
            isModpack,      
          });

          const backupStore = await findChildFolderByName(drive, serverRootId, "backup-store");
          if (!backupStore) throw new Error("backup-store missing");

          const snapshotsFolder = await findChildFolderByName(drive, backupStore.id, "snapshots");
          if (!snapshotsFolder) throw new Error("snapshots folder missing");

          restoreVerificationByServer.set(serverId, {
            ...queuedStatus,
            state: "running",
            message: "Restore check running",
            current: 0,
            total: 1,
            percent: 0,
          });
          emitRestoreVerificationStatus(serverId);

          const result = await verifySnapshotRestoreV2({
            drive,
            snapshotFolderId: snapshotId,
            serverPath,
            accessToken,
            onProgress: (progress) => {
              const prev = restoreVerificationByServer.get(serverId) ?? queuedStatus;
              restoreVerificationByServer.set(serverId, {
                ...prev,
                state: "running",
                message: progress.message,
                current: progress.current,
                total: progress.total,
                percent: progress.percent,
              });
              emitRestoreVerificationStatus(serverId);
            },
          });

          const passed =
            result.missingFiles.length === 0 &&
            result.failedFiles.length === 0;

          restoreVerificationByServer.set(serverId, {
            serverId,
            state: passed ? "passed" : "failed",
            snapshotId,
            message: passed
              ? "Restore check passed"
              : "Restore check found issues",
            current: result.checkedFiles,
            total: result.checkedFiles,
            percent: 100,
            checkedFiles: result.checkedFiles,
            verifiedFiles: result.verifiedFiles,
            missingFiles: result.missingFiles,
            failedFiles: result.failedFiles,
            startedAt: queuedStatus.startedAt,
            finishedAt: Date.now(),
          });
          emitRestoreVerificationStatus(serverId);
        } catch (err: any) {
          restoreVerificationByServer.set(serverId, {
            serverId,
            state: "failed",
            snapshotId,
            message: err?.message || String(err),
            current: 0,
            total: 1,
            percent: 0,
            missingFiles: [],
            failedFiles: [],
            startedAt: queuedStatus.startedAt,
            finishedAt: Date.now(),
          });
          emitRestoreVerificationStatus(serverId);
        } finally {
          restoreVerificationJobs.delete(serverId);
        }
      })();

      restoreVerificationJobs.set(serverId, job);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }
);

ipcMain.handle("get-restore-verification-status", async (_event, { serverId }) => {
  return {
    success: true,
    status:
      restoreVerificationByServer.get(serverId) ?? {
        serverId,
        state: "idle",
        snapshotId: null,
        message: "No restore check running",
        current: 0,
        total: 0,
        percent: 0,
        startedAt: null,
        finishedAt: null,
      },
  };
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

async function detectPreparedServerRuntime(args: {
  loader: string;
  extractPath: string;
}): Promise<{
  success: boolean;
  ready: boolean;
  launchMode?: "jar" | "forge-args";
  launcherJar?: string | null;
  userJvmArgsPath?: string | null;
  winArgsPath?: string | null;
  unixArgsPath?: string | null;
  error?: string;
}> {
  try {
    const { loader, extractPath } = args;

    if (!loader || !extractPath) {
      throw new Error("Missing loader or extractPath.");
    }

    if (loader === "forge") {
      const detected = await detectForgeLaunch(extractPath);

      if (!detected) {
        return { success: true, ready: false };
      }

      if (detected.mode === "jar") {
        return {
          success: true,
          ready: true,
          launchMode: "jar",
          launcherJar: detected.jarPath,
        };
      }

      return {
        success: true,
        ready: true,
        launchMode: "forge-args",
        userJvmArgsPath: detected.userJvmArgsPath,
        winArgsPath: detected.winArgsPath ?? null,
        unixArgsPath: detected.unixArgsPath ?? null,
      };
    }

    const jarPath = path.join(extractPath, "server.jar");
    const exists = await fileExists(jarPath);

    return {
      success: true,
      ready: exists,
      launchMode: "jar",
      launcherJar: exists ? jarPath : null,
    };
  } catch (error) {
    return {
      success: false,
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

ipcMain.handle("detect-prepared-server-runtime", async (_event, args) => {
  return await detectPreparedServerRuntime(args);
});

ipcMain.handle("check-server-runtime", async (_event, args) => {
  try {
    const { loader, extractPath } = args ?? {};

    if (!loader || !extractPath) {
      throw new Error("Missing loader or extractPath.");
    }

    if (loader === "forge") {
      const detected = await detectForgeLaunch(extractPath);

      if (!detected) {
        return { success: true, ready: false };
      }

      if (detected.mode === "jar") {
        return {
          success: true,
          ready: true,
          launchMode: "jar" as const,
          launcherJar: detected.jarPath,
        };
      }

      return {
        success: true,
        ready: true,
        launchMode: "forge-args" as const,
        userJvmArgsPath: detected.userJvmArgsPath,
        winArgsPath: detected.winArgsPath ?? null,
        unixArgsPath: detected.unixArgsPath ?? null,
      };
    }

    const serverJarPath = path.join(extractPath, "server.jar");
    const exists = await fileExists(serverJarPath);

    return {
      success: true,
      ready: exists,
      launchMode: "jar" as const,
      launcherJar: exists ? serverJarPath : null,
    };
  } catch (error) {
    return {
      success: false,
      ready: false,
      error: error instanceof Error ? error.message : String(error),
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



ipcMain.handle("list-server-backups", async (_event, { serverId, loader, accessToken, driveFolderId, isModpack }: any) => {
  try {
    const drive = createDriveClient(accessToken);

    const serverRootId = await ensureDriveFolderPath({
      accessToken,
      serverId,
      loader,
      driveFolderId,  
      isModpack,      
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
  async (_event, { snapshotId, serverPath, serverId, loader, accessToken, driveFolderId, isModpack }: any) => {
    try {
      const drive = createDriveClient(accessToken)

      const serverRootId = await ensureDriveFolderPath({
        accessToken,
        serverId,
        loader,
        driveFolderId,  
        isModpack,      
      })

      const backupStore = await findChildFolderByName(drive, serverRootId, "backup-store")
      
      if (!backupStore) throw new Error("backup-store missing")

      const snapshotsFolder = await findChildFolderByName(drive, backupStore.id, "snapshots")
      if (!snapshotsFolder) throw new Error("snapshots folder missing")

      mainWindow?.webContents.send("restore-progress", {
        phase: "starting",
        message: "Preparing restore",
        current: 0,
        total: 1,
        percent: 0,
      })

      const result = await restoreSnapshotV2({
        drive,
        snapshotFolderId: snapshotId,
        serverPath,
        accessToken,
        onProgress: (progress) => {
          mainWindow?.webContents.send("restore-progress", progress)
        }
      })

      mainWindow?.webContents.send("restore-progress", {
        phase: "done",
        message: "Restore completed",
        current: 1,
        total: 1,
        percent: 100,
      })

      return result
    } catch (err: any) {
      console.error("Snapshot restore failed:", err)

      mainWindow?.webContents.send("restore-progress", {
        phase: "error",
        message: err?.message || String(err),
        current: 0,
        total: 1,
        percent: 0,
      })

      return {
        success: false,
        error: err.message
      }
    }
  }
)

ipcMain.handle("get-valid-access-token", async (_e, args) => {
  const { userId, driveId } = args;
  const key = getAccessTokenCacheKey(userId, driveId);
  const now = Date.now();

  const cached = accessTokenCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  console.log("🔥 get-valid-access-token CALLED", args);

  const token = await getValidAccessToken(userId, driveId);

  accessTokenCache.set(key, {
    token,
    expiresAt: now + 50 * 60 * 1000, // 50 perc
  });

  return token;
});

ipcMain.handle("getValidAccessToken", async (_event, createdBy, linkedDriveId) => {
  const key = getAccessTokenCacheKey(createdBy, linkedDriveId);
  const now = Date.now();

  const cached = accessTokenCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  const token = await getValidAccessToken(createdBy, linkedDriveId);

  accessTokenCache.set(key, {
    token,
    expiresAt: now + 50 * 60 * 1000,
  });

  return token;
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
      accessToken,
    }: {
      serverId: string;
      role?: string;
      extractPath?: string;
      ram?: string | null;
      mcVersion?: string | null;
      isAdmin?: boolean;
      accessToken?: string | null;
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
    if (accessToken) params.set("accessToken", accessToken);

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
  pathToServerJar?: string | null;
  launchMode: "jar" | "forge-args";
  serverFolder: string;
  forgeUserJvmArgsPath?: string | null;
  forgeWinArgsPath?: string | null;
  forgeUnixArgsPath?: string | null;
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
  mcVersion: string;
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
  pathToServerJar?: string | null;
  launchMode?: "jar" | "forge-args";
  forgeUserJvmArgsPath?: string | null;
  forgeWinArgsPath?: string | null;
  forgeUnixArgsPath?: string | null;
  serverFolder?: string | null;
  ram: string;
  preferredPort?: number;
  restartOnCrash?: boolean;
  restartAttempts?: number;
  maxRestartAttempts?: number;
  restartDelayMs?: number;
  launchReason?: "manual" | "restart";
  mcVersion: string;
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
  pathToServerJar?: string | null;
  launchMode?: "jar" | "forge-args";
  forgeUserJvmArgsPath?: string | null;
  forgeWinArgsPath?: string | null;
  forgeUnixArgsPath?: string | null;
  serverFolder?: string | null;
  ram: string;
  preferredPort?: number;
  restartOnCrash?: boolean;
  restartAttempts: number;
  maxRestartAttempts: number;
  restartDelayMs: number;
  mcVersion: string;
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
        pathToServerJar: args.pathToServerJar ?? null,
        launchMode: args.launchMode ?? "jar",
        forgeUserJvmArgsPath: args.forgeUserJvmArgsPath ?? null,
        forgeWinArgsPath: args.forgeWinArgsPath ?? null,
        forgeUnixArgsPath: args.forgeUnixArgsPath ?? null,
        serverFolder: args.serverFolder ?? null,
        ram: args.ram,
        preferredPort: args.preferredPort,
        restartOnCrash: args.restartOnCrash,
        restartAttempts: args.restartAttempts,
        maxRestartAttempts: args.maxRestartAttempts,
        restartDelayMs: args.restartDelayMs,
        launchReason: "restart",
        mcVersion: args.mcVersion,
      });
    } catch (err: any) {
      const errLog = `[mc-server-manager] Auto-restart failed: ${err?.message || String(err)}\n`;
      appendServerLog(args.serverId, errLog);
      sendToRelevantWindows("server-log", { serverId: args.serverId, log: errLog }, args.serverId);
    }
  }, args.restartDelayMs);
}

async function writeForgeUserJvmArgsFile(userJvmArgsPath: string, ram: string): Promise<void> {
  const content = `-Xms${ram}\n-Xmx${ram}\n`;
  await fs.promises.writeFile(userJvmArgsPath, content, "utf8");
}

async function launchServerProcess({
  serverId,
  pathToServerJar,
  launchMode = "jar",
  forgeUserJvmArgsPath,
  forgeWinArgsPath,
  forgeUnixArgsPath,
  serverFolder,
  ram,
  preferredPort,
  restartOnCrash = true,
  restartAttempts = 0,
  maxRestartAttempts = 3,
  restartDelayMs = 5000,
  launchReason = "manual",
  mcVersion,
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

  const resolvedServerFolder =
    serverFolder ||
    (pathToServerJar ? path.dirname(pathToServerJar) : null) ||
    (forgeUserJvmArgsPath ? path.dirname(forgeUserJvmArgsPath) : null);

  if (!resolvedServerFolder) {
    return { success: false, error: "Missing server folder for launch." };
  }

  const writePropsResult = await writeServerPropertiesFile(resolvedServerFolder, {
    "server-port": String(chosenPort),
  });

  if (!writePropsResult.success) {
    return {
      success: false,
      error: writePropsResult.error || "Failed to write server.properties",
    };
  }

  const javaExec = resolveJavaExecutable(mcVersion);
  let args: string[] = [];

  if (launchMode === "forge-args") {
    if (!forgeUserJvmArgsPath) {
      return { success: false, error: "Missing Forge user_jvm_args.txt path." };
    }

    const argsFile =
      process.platform === "win32"
        ? forgeWinArgsPath
        : (forgeUnixArgsPath || forgeWinArgsPath);

    if (!argsFile) {
      return { success: false, error: "Missing Forge args file." };
    }

    await writeForgeUserJvmArgsFile(forgeUserJvmArgsPath, ram);

    const relUserJvmArgs = path.relative(resolvedServerFolder, forgeUserJvmArgsPath).replace(/\\/g, "/");
    const relArgsFile = path.relative(resolvedServerFolder, argsFile).replace(/\\/g, "/");

    args = [`@${relUserJvmArgs}`, `@${relArgsFile}`, "nogui"];
  } else {
    if (!pathToServerJar) {
      return { success: false, error: "Missing server jar path." };
    }

    args = [
      `-Xmx${ram}`,
      `-Xms${ram}`,
      "-jar",
      pathToServerJar,
      "nogui",
    ];
  }

  console.log("[DEBUG] Using Java executable:", javaExec);
  console.log("[DEBUG] Launch mode:", launchMode);
  console.log("[DEBUG] Launch cwd:", resolvedServerFolder);
  console.log("[DEBUG] Launch args:", args);

  const proc = spawn(javaExec, args, {
    cwd: resolvedServerFolder,
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout.on("data", (data: Buffer) => {
    const log = data.toString();

    const joinedMatch = log.match(/\]: ([^[]+?) joined the game/);
    if (joinedMatch?.[1]) addOnlinePlayer(serverId, joinedMatch[1].trim());

    const leftMatch = log.match(/\]: ([^[]+?) left the game/);
    if (leftMatch?.[1]) removeOnlinePlayer(serverId, leftMatch[1].trim());

    appendServerLog(serverId, log);
    handleServerReadyFromLog(serverId, log);
    sendToRelevantWindows("server-log", { serverId, log }, serverId);
  });

  proc.stderr.on("data", (data: Buffer) => {
    const log = data.toString();

    const joinedMatch = log.match(/\]: ([^[]+?) joined the game/);
    if (joinedMatch?.[1]) addOnlinePlayer(serverId, joinedMatch[1].trim());

    const leftMatch = log.match(/\]: ([^[]+?) left the game/);
    if (leftMatch?.[1]) removeOnlinePlayer(serverId, leftMatch[1].trim());

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
        pathToServerJar: current.pathToServerJar ?? null,
        launchMode: current.launchMode,
        forgeUserJvmArgsPath: current.forgeUserJvmArgsPath ?? null,
        forgeWinArgsPath: current.forgeWinArgsPath ?? null,
        forgeUnixArgsPath: current.forgeUnixArgsPath ?? null,
        serverFolder: current.serverFolder,
        ram: current.ram,
        preferredPort: current.port,
        restartOnCrash: current.restartOnCrash,
        restartAttempts: current.restartAttempts + 1,
        maxRestartAttempts: current.maxRestartAttempts,
        restartDelayMs: current.restartDelayMs,
        mcVersion: current.mcVersion,
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

    clearOnlinePlayers(serverId);
    runningServers.delete(serverId);

    if (shouldRestart && restartConfig) {
      void scheduleAutoRestart(restartConfig);
    }
  });

  clearOnlinePlayers(serverId);

  runningServers.set(serverId, {
    serverId,
    proc,
    pathToServerJar: pathToServerJar ?? null,
    launchMode,
    serverFolder: resolvedServerFolder,
    forgeUserJvmArgsPath: forgeUserJvmArgsPath ?? null,
    forgeWinArgsPath: forgeWinArgsPath ?? null,
    forgeUnixArgsPath: forgeUnixArgsPath ?? null,
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
    mcVersion: mcVersion,
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
      extractPath: running.serverFolder,
      pathToServerJar: running.pathToServerJar ?? null,
      launchMode: running.launchMode,
      forgeUserJvmArgsPath: running.forgeUserJvmArgsPath ?? null,
      forgeWinArgsPath: running.forgeWinArgsPath ?? null,
      forgeUnixArgsPath: running.forgeUnixArgsPath ?? null,
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
      launchMode,
      forgeUserJvmArgsPath,
      forgeWinArgsPath,
      forgeUnixArgsPath,
      serverFolder,
      ram,
      preferredPort,
      mcVersion,
    }: {
      serverId: string;
      pathToServerJar?: string | null;
      launchMode?: "jar" | "forge-args";
      forgeUserJvmArgsPath?: string | null;
      forgeWinArgsPath?: string | null;
      forgeUnixArgsPath?: string | null;
      serverFolder?: string | null;
      ram: string;
      preferredPort?: number;
      mcVersion: string; // <--- Újra kötelező (nincs kérdőjel)
    }
  ) => {
    try {
      return await launchServerProcess({
        serverId,
        pathToServerJar: pathToServerJar ?? null,
        launchMode: launchMode ?? "jar",
        forgeUserJvmArgsPath: forgeUserJvmArgsPath ?? null,
        forgeWinArgsPath: forgeWinArgsPath ?? null,
        forgeUnixArgsPath: forgeUnixArgsPath ?? null,
        serverFolder: serverFolder ?? null,
        ram,
        preferredPort,
        restartOnCrash: true,
        restartAttempts: 0,
        maxRestartAttempts: 3,
        restartDelayMs: 5000,
        launchReason: "manual",
        mcVersion, // <--- Közvetlenül megy be a scannerhez!
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

ipcMain.handle(
  "get-online-players",
  async (_event, { serverId }: { serverId: string }) => {
    return {
      success: true,
      players: getOnlinePlayersSnapshot(serverId),
    };
  }
);

ipcMain.handle(
  "timeout-players",
  async (
    _event,
    {
      serverId,
      players,
      minutes,
      reason,
    }: {
      serverId: string;
      players: string[];
      minutes: number;
      reason?: string;
    }
  ) => {
    try {
      const server = runningServers.get(serverId);

      if (!server || !server.proc || server.proc.killed) {
        return { success: false, error: "Server is not running." };
      }

      const safePlayers = players.map((p) => p.trim()).filter(Boolean);
      if (!safePlayers.length) {
        return { success: false, error: "No players to timeout." };
      }

      const safeMinutes = Math.max(1, Math.floor(minutes || 1));
      const timeoutReason =
        reason?.trim() || `Temporary timeout (${safeMinutes} min)`;

      for (const player of safePlayers) {
        server.proc.stdin.write(`ban ${player} ${timeoutReason}\n`);

        setTimeout(() => {
          const current = runningServers.get(serverId);
          if (!current || !current.proc || current.proc.killed) return;

          current.proc.stdin.write(`pardon ${player}\n`);
        }, safeMinutes * 60 * 1000);
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || "Failed to timeout players.",
      };
    }
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


