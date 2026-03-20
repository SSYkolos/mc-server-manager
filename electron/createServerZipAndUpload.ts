import { google } from "googleapis";
import { Readable } from "stream";
import JSZip from "jszip";
import type { LoaderType } from "./shared/types";

const SERVER_PROPERTIES_TEMPLATE = `#Minecraft server properties
#${new Date().toString()}
accepts-transfers=false
allow-flight=false
allow-nether=true
broadcast-console-to-ops=true
broadcast-rcon-to-ops=true
bug-report-link=
difficulty=easy
enable-command-block=false
enable-jmx-monitoring=false
enable-query=false
enable-rcon=false
enable-status=true
enforce-secure-profile=true
enforce-whitelist=false
entity-broadcast-range-percentage=100
force-gamemode=false
function-permission-level=2
gamemode=survival
generate-structures=true
generator-settings={}
hardcore=false
hide-online-players=false
initial-disabled-packs=
initial-enabled-packs=vanilla
level-name=world
level-seed=
level-type=minecraft\\:normal
log-ips=true
max-chained-neighbor-updates=1000000
max-players=20
max-tick-time=60000
max-world-size=29999984
motd=A Minecraft Server
network-compression-threshold=256
online-mode=true
op-permission-level=4
pause-when-empty-seconds=60
player-idle-timeout=0
prevent-proxy-connections=false
pvp=true
query.port=25565
rate-limit=0
rcon.password=
rcon.port=25575
region-file-compression=deflate
require-resource-pack=false
resource-pack=
resource-pack-id=
resource-pack-prompt=
resource-pack-sha1=
server-ip=
server-port=25565
simulation-distance=10
spawn-monsters=true
spawn-protection=16
sync-chunk-writes=true
text-filtering-config=
text-filtering-version=0
use-native-transport=true
view-distance=10
white-list=false`;

export async function createAndUploadServerZip({
  accessToken,
  driveFolderId,
  serverId,
  loader,
  mcVersion,
  settings = {},
}: {
  accessToken: string;
  driveFolderId: string;
  serverId: string;
  loader: LoaderType;
  mcVersion: string | undefined;
  settings?: Record<string, string>;
}): Promise<string> {
  const zip = new JSZip();

  // --- server.properties ---
  const defaultProps: Record<string, string> = Object.fromEntries(
    SERVER_PROPERTIES_TEMPLATE.split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=")];
      })
  );

  const validKeys = Object.keys(defaultProps);
  const runtimeOverrideKeys = ["view-distance", "simulation-distance"];

  const filteredSettings: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (validKeys.includes(key) && !runtimeOverrideKeys.includes(key)) {
      filteredSettings[key] = value;
    }
  }

  const finalProps = { ...defaultProps, ...filteredSettings };

  const serverProperties = [
    `#Minecraft server properties`,
    `#${new Date().toString()}`,
    ...Object.entries(finalProps).map(([key, value]) => `${key}=${value}`),
  ].join("\n");

  zip.file("server.properties", serverProperties);

  // --- metadata.json ---
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!validKeys.includes(key)) metadata[key] = value;
  }
  for (const key of runtimeOverrideKeys) {
    if (key in settings) metadata[key] = settings[key];
  }
  if (!("mcVersion" in metadata)) metadata.mcVersion = mcVersion ?? "";
  if (!("loader" in metadata)) metadata.loader = loader ?? "";

  zip.file("metadata.json", JSON.stringify(metadata, null, 2));

  // --- generate zip buffer ---
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  // --- upload to Google Drive ---
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: "v3", auth });

  const uploadResponse = await drive.files.create({
    requestBody: {
      name: `${serverId}.zip`,
      parents: [driveFolderId],
    },
    media: {
      mimeType: "application/zip",
      body: Readable.from(zipBuffer),
    },
    supportsAllDrives: true,
  });

  const fileId = uploadResponse.data.id;
  if (!fileId) throw new Error("Failed to upload server zip to Google Drive");

  // --- make public ---
  await drive.permissions.create({
    fileId,
    supportsAllDrives: true,
    requestBody: { role: "reader", type: "anyone" },
  });

  console.log("✅ Server zip uploaded and shared:", fileId);
  return fileId;
}


