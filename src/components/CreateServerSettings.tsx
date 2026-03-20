import React from "react";
import { CreateServerSettingsProps } from "../types/types";

const AccordionSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => {
  const [open, setOpen] = React.useState(true);
  return (
    <section className="mb-6 border rounded">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-gray-200 px-4 py-2 font-semibold text-left flex justify-between items-center"
      >
        <span>{title}</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="p-4">{children}</div>}
    </section>
  );
};

export const CreateServerSettings: React.FC<CreateServerSettingsProps> = ({
  value,
  update,
}) => {
  return (
    <>
      {/* Basic Info */}
      <AccordionSection title="Basic Info">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Server Name</label>
            <input
              type="text"
              value={value.serverName}
              onChange={(e) => update("serverName", e.target.value)}
              className="w-full border px-3 py-1 rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">MOTD</label>
            <input
              type="text"
              value={value.motd}
              onChange={(e) => update("motd", e.target.value)}
              className="w-full border px-3 py-1 rounded"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-1">Level Name</label>
          <input
            type="text"
            value={value.levelName}
            onChange={(e) => update("levelName", e.target.value)}
            className="w-full border px-3 py-1 rounded"
          />
        </div>
      </AccordionSection>

      {/* Game Settings */}
      <AccordionSection title="Game Settings">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Gamemode</label>
            <select
              value={value.gamemode}
              onChange={(e) => update("gamemode", e.target.value)}
              className="w-full border px-3 py-1 rounded"
            >
              <option value="survival">Survival</option>
              <option value="creative">Creative</option>
              <option value="adventure">Adventure</option>
              <option value="spectator">Spectator</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Difficulty</label>
            <select
              value={value.difficulty}
              onChange={(e) => update("difficulty", e.target.value)}
              className="w-full border px-3 py-1 rounded"
            >
              <option value="peaceful">Peaceful</option>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div className="flex flex-col justify-center space-y-2">
            <label className="inline-flex items-center space-x-2">
              <input
                type="checkbox"
                checked={value.pvp}
                onChange={(e) => update("pvp", e.target.checked)}
              />
              <span>PvP Enabled</span>
            </label>

            <label className="inline-flex items-center space-x-2">
              <input
                type="checkbox"
                checked={value.hardcore}
                onChange={(e) => update("hardcore", e.target.checked)}
              />
              <span>Hardcore Mode</span>
            </label>
          </div>
        </div>
      </AccordionSection>

{/* Loader and Version */}
<AccordionSection title="Loader & Version">
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
    <div>
      <label className="block text-sm font-medium mb-1">Loader</label>
      <select
        value={value.loader}
        onChange={(e) => update("loader", e.target.value)}
        className="w-full border px-3 py-1 rounded"
      >
        <option value="vanilla">Vanilla</option>
        <option value="paper">Paper</option>
        <option value="purpur">Purpur</option>
        <option value="fabric">Fabric</option>
        <option value="forge">Forge</option>
        <option value="neoforge">NeoForge</option>
      </select>
    </div>

    <div>
      <label className="block text-sm font-medium mb-1">Minecraft Version</label>
      <input
        type="text"
        value={value.mcVersion ?? ""}
        onChange={(e) => update("mcVersion", e.target.value)}
        className="w-full border px-3 py-1 rounded"
        placeholder="e.g. 1.21.1"
      />
    </div>

    <div>
      <label className="block text-sm font-medium mb-1">Loader Version</label>
      <input
        type="text"
        value={value.loaderVersion ?? ""}
        onChange={(e) => update("loaderVersion", e.target.value)}
        className="w-full border px-3 py-1 rounded"
        placeholder={
          value.loader === "fabric"
            ? "e.g. 0.16.10"
            : value.loader === "forge" || value.loader === "neoforge"
            ? "e.g. loader/build version"
            : "Usually not needed"
        }
        disabled={
          value.loader === "vanilla" ||
          value.loader === "paper" ||
          value.loader === "purpur"
        }
      />
    </div>
  </div>
</AccordionSection>

      {/* World Settings */}
      <AccordionSection title="World Settings">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">World Seed</label>
            <input
              type="text"
              value={value.seed}
              onChange={(e) => update("seed", e.target.value)}
              className="w-full border px-3 py-1 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Level Type</label>
            <select
              value={value.levelType}
              onChange={(e) => update("levelType", e.target.value)}
              className="w-full border px-3 py-1 rounded"
            >
              <option value="default">Default</option>
              <option value="flat">Flat</option>
              <option value="largeBiomes">Large Biomes</option>
              <option value="amplified">Amplified</option>
            </select>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={value.generateStructures}
              onChange={(e) => update("generateStructures", e.target.checked)}
            />
            <span>Generate Structures</span>
          </label>

          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={value.allowNether}
              onChange={(e) => update("allowNether", e.target.checked)}
            />
            <span>Allow Nether</span>
          </label>
        </div>
      </AccordionSection>

      {/* Performance and Limits */}
      <AccordionSection title="Performance & Limits">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">View Distance</label>
            <input
              type="number"
              min={2}
              max={32}
              value={value.viewDistance}
              onChange={(e) => update("viewDistance", Number(e.target.value))}
              className="w-full border px-3 py-1 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Max World Size</label>
            <input
              type="number"
              min={1}
              max={29999984}
              value={value.maxWorldSize}
              onChange={(e) => update("maxWorldSize", Number(e.target.value))}
              className="w-full border px-3 py-1 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Spawn Protection</label>
            <input
              type="number"
              min={0}
              max={32}
              value={value.spawnProtection}
              onChange={(e) => update("spawnProtection", Number(e.target.value))}
              className="w-full border px-3 py-1 rounded"
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={value.enableCommandBlock}
              onChange={(e) => update("enableCommandBlock", e.target.checked)}
            />
            <span>Enable Command Block</span>
          </label>

          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={value.allowFlight}
              onChange={(e) => update("allowFlight", e.target.checked)}
            />
            <span>Allow Flight</span>
          </label>

          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={value.syncChunkWrites}
              onChange={(e) => update("syncChunkWrites", e.target.checked)}
            />
            <span>Sync Chunk Writes</span>
          </label>
        </div>
      </AccordionSection>

      {/* Player & Security */}
      <AccordionSection title="Player & Security">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Max Players</label>
            <input
              type="number"
              min={1}
              max={100}
              value={value.maxPlayers}
              onChange={(e) => update("maxPlayers", Number(e.target.value))}
              className="w-full border px-3 py-1 rounded"
            />
          </div>

          <div className="space-y-2">
            <label className="inline-flex items-center space-x-2">
              <input
                type="checkbox"
                checked={value.onlineMode}
                onChange={(e) => update("onlineMode", e.target.checked)}
              />
              <span>Online Mode</span>
            </label>

            <label className="inline-flex items-center space-x-2">
              <input
                type="checkbox"
                checked={value.whiteList}
                onChange={(e) => update("whiteList", e.target.checked)}
              />
              <span>Whitelist Enabled</span>
            </label>

            <label className="inline-flex items-center space-x-2">
              <input
                type="checkbox"
                checked={value.enforceWhitelist}
                onChange={(e) => update("enforceWhitelist", e.target.checked)}
              />
              <span>Enforce Whitelist</span>
            </label>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={value.enableRcon}
              onChange={(e) => update("enableRcon", e.target.checked)}
            />
            <span>Enable RCON</span>
          </label>

          {value.enableRcon && (
            <div>
              <label className="block text-sm font-medium mb-1">RCON Password</label>
              <input
                type="password"
                value={value.rconPassword}
                onChange={(e) => update("rconPassword", e.target.value)}
                className="w-full border px-3 py-1 rounded"
              />
            </div>
          )}
        </div>
      </AccordionSection>

      {/* Miscellaneous */}
      <AccordionSection title="Miscellaneous">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Resource Pack URL</label>
            <input
              type="text"
              value={value.resourcePack}
              onChange={(e) => update("resourcePack", e.target.value)}
              className="w-full border px-3 py-1 rounded"
              placeholder="URL to resource pack"
            />
          </div>

          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={value.enableStatus}
              onChange={(e) => update("enableStatus", e.target.checked)}
            />
            <span>Enable Server Status</span>
          </label>
        </div>
      </AccordionSection>
    </>
  );
};