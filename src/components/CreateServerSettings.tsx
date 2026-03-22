import React from "react";
import { CreateServerSettingsProps } from "../types/types";

type CreateMode = "create" | "import-world" | "import-server";

type AccordionSectionProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
};

const AccordionSection: React.FC<AccordionSectionProps> = ({
  title,
  subtitle,
  children,
  defaultOpen = true,
}) => {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between bg-gray-50 px-5 py-4 text-left hover:bg-gray-100 transition"
      >
        <div>
          <div className="text-base font-semibold text-gray-900">{title}</div>
          {subtitle && (
            <div className="mt-0.5 text-sm text-gray-500">{subtitle}</div>
          )}
        </div>
        <span className="ml-4 text-sm text-gray-700">{open ? "▲" : "▼"}</span>
      </button>

      {open && <div className="p-5">{children}</div>}
    </section>
  );
};

type FieldProps = {
  label: string;
  children: React.ReactNode;
  hint?: string;
};

const Field: React.FC<FieldProps> = ({ label, children, hint }) => (
  <div>
    <label className="mb-1 block text-sm font-medium text-gray-800">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
  </div>
);

const textInputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const checkboxRowClass =
  "flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2";

type Props = CreateServerSettingsProps & {
  mode?: CreateMode;
  forgeVersions?: string[];
  loadingForgeVersions?: boolean;
};

export const CreateServerSettings: React.FC<Props> = ({
  value,
  update,
  mode = "create",
  forgeVersions = [],
  loadingForgeVersions = false,
}) => {
  const isImportWorld = mode === "import-world" || mode === "import-server";

  return (
    <>
      <AccordionSection
        title="Basic Info"
        subtitle={
          isImportWorld
            ? "Core server presentation settings for the imported world."
            : "Basic identity and presentation settings."
        }
      >
        <div className="space-y-4">
          <Field label="MOTD" hint="This is the message shown in the multiplayer server list.">
            <input
              type="text"
              value={value.motd}
              onChange={(e) => update("motd", e.target.value)}
              className={textInputClass}
              placeholder="A Minecraft Server"
            />
          </Field>

          {!isImportWorld && (
            <Field
              label="Level Name"
              hint="Used for newly created worlds. This should match the world folder name."
            >
              <input
                type="text"
                value={value.levelName}
                onChange={(e) => update("levelName", e.target.value)}
                className={textInputClass}
                placeholder="world"
              />
            </Field>
          )}
        </div>
      </AccordionSection>

      <AccordionSection
        title="Loader & Version"
        subtitle="Choose the server software and Minecraft version."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Loader">
            <select
              value={value.loader}
              onChange={(e) => update("loader", e.target.value)}
              className={textInputClass}
            >
              <option value="vanilla">Vanilla</option>
              <option value="paper">Paper</option>
              <option value="purpur">Purpur</option>
              <option value="fabric">Fabric</option>
              <option value="forge">Forge</option>
              <option value="neoforge">NeoForge</option>
            </select>
          </Field>

          <Field
            label="Minecraft Version"
            hint="Required for both fresh servers and world import."
          >
            <input
              type="text"
              value={value.mcVersion ?? ""}
              onChange={(e) => update("mcVersion", e.target.value)}
              className={textInputClass}
              placeholder="e.g. 1.21.10"
            />
          </Field>

          <Field
            label="Loader Version"
            hint={
              value.loader === "fabric"
                ? "Required for Fabric."
                : value.loader === "forge"
                ? "Choose a Forge build that matches the selected Minecraft version."
                : value.loader === "neoforge"
                ? "Use the matching loader/build version."
                : "Usually not needed."
            }
          >
            {value.loader === "forge" ? (
              <select
                value={value.loaderVersion ?? ""}
                onChange={(e) => update("loaderVersion", e.target.value)}
                className={textInputClass}
                disabled={!value.mcVersion?.trim() || loadingForgeVersions}
              >
                {!value.mcVersion?.trim() ? (
                  <option value="">Select Minecraft version first</option>
                ) : loadingForgeVersions ? (
                  <option value="">Loading Forge versions...</option>
                ) : forgeVersions.length === 0 ? (
                  <option value="">No Forge versions found</option>
                ) : (
                  forgeVersions.map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))
                )}
              </select>
            ) : (
              <input
                type="text"
                value={value.loaderVersion ?? ""}
                onChange={(e) => update("loaderVersion", e.target.value)}
                className={`${textInputClass} ${
                  value.loader === "vanilla" ||
                  value.loader === "paper" ||
                  value.loader === "purpur"
                    ? "bg-gray-100 text-gray-400"
                    : ""
                }`}
                placeholder={
                  value.loader === "fabric"
                    ? "e.g. 0.16.10"
                    : value.loader === "neoforge"
                    ? "e.g. loader/build version"
                    : "Usually not needed"
                }
                disabled={
                  value.loader === "vanilla" ||
                  value.loader === "paper" ||
                  value.loader === "purpur"
                }
              />
            )}
          </Field>
        </div>
      </AccordionSection>

      <AccordionSection
        title="Game Settings"
        subtitle="Player-facing gameplay defaults and difficulty."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Gamemode">
            <select
              value={value.gamemode}
              onChange={(e) => update("gamemode", e.target.value)}
              className={textInputClass}
            >
              <option value="survival">Survival</option>
              <option value="creative">Creative</option>
              <option value="adventure">Adventure</option>
              <option value="spectator">Spectator</option>
            </select>
          </Field>

          <Field label="Difficulty">
            <select
              value={value.difficulty}
              onChange={(e) => update("difficulty", e.target.value)}
              className={textInputClass}
            >
              <option value="peaceful">Peaceful</option>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </Field>

          <div className="space-y-2">
            <div className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={value.pvp}
                onChange={(e) => update("pvp", e.target.checked)}
              />
              <span className="text-sm text-gray-800">PvP Enabled</span>
            </div>

            <div className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={value.hardcore}
                onChange={(e) => update("hardcore", e.target.checked)}
              />
              <span className="text-sm text-gray-800">Hardcore Mode</span>
            </div>
          </div>
        </div>
      </AccordionSection>

      {!isImportWorld && (
        <AccordionSection
          title="World Settings"
          subtitle="These settings apply only when creating a fresh new world."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="World Seed">
              <input
                type="text"
                value={value.seed}
                onChange={(e) => update("seed", e.target.value)}
                className={textInputClass}
                placeholder="Leave empty for random"
              />
            </Field>

            <Field label="Level Type">
              <select
                value={value.levelType}
                onChange={(e) => update("levelType", e.target.value)}
                className={textInputClass}
              >
                <option value="default">Default</option>
                <option value="flat">Flat</option>
                <option value="largeBiomes">Large Biomes</option>
                <option value="amplified">Amplified</option>
              </select>
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={value.generateStructures}
                onChange={(e) => update("generateStructures", e.target.checked)}
              />
              <span className="text-sm text-gray-800">Generate Structures</span>
            </div>

            <div className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={value.allowNether}
                onChange={(e) => update("allowNether", e.target.checked)}
              />
              <span className="text-sm text-gray-800">Allow Nether</span>
            </div>
          </div>
        </AccordionSection>
      )}

      <AccordionSection
        title="Performance & Limits"
        subtitle="Tuning for render distance, world bounds, and server behavior."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="View Distance">
            <input
              type="number"
              min={2}
              max={32}
              value={value.viewDistance}
              onChange={(e) => update("viewDistance", Number(e.target.value))}
              className={textInputClass}
            />
          </Field>

          <Field label="Max World Size">
            <input
              type="number"
              min={1}
              max={29999984}
              value={value.maxWorldSize}
              onChange={(e) => update("maxWorldSize", Number(e.target.value))}
              className={textInputClass}
            />
          </Field>

          <Field label="Spawn Protection">
            <input
              type="number"
              min={0}
              max={32}
              value={value.spawnProtection}
              onChange={(e) => update("spawnProtection", Number(e.target.value))}
              className={textInputClass}
            />
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={value.enableCommandBlock}
              onChange={(e) => update("enableCommandBlock", e.target.checked)}
            />
            <span className="text-sm text-gray-800">Enable Command Block</span>
          </div>

          <div className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={value.allowFlight}
              onChange={(e) => update("allowFlight", e.target.checked)}
            />
            <span className="text-sm text-gray-800">Allow Flight</span>
          </div>

          <div className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={value.syncChunkWrites}
              onChange={(e) => update("syncChunkWrites", e.target.checked)}
            />
            <span className="text-sm text-gray-800">Sync Chunk Writes</span>
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        title="Player & Security"
        subtitle="Limits, whitelist rules, and remote access settings."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Max Players">
            <input
              type="number"
              min={1}
              max={100}
              value={value.maxPlayers}
              onChange={(e) => update("maxPlayers", Number(e.target.value))}
              className={textInputClass}
            />
          </Field>

          <div className="space-y-2">
            <div className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={value.onlineMode}
                onChange={(e) => update("onlineMode", e.target.checked)}
              />
              <span className="text-sm text-gray-800">Online Mode</span>
            </div>

            <div className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={value.whiteList}
                onChange={(e) => update("whiteList", e.target.checked)}
              />
              <span className="text-sm text-gray-800">Whitelist Enabled</span>
            </div>

            <div className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={value.enforceWhitelist}
                onChange={(e) => update("enforceWhitelist", e.target.checked)}
              />
              <span className="text-sm text-gray-800">Enforce Whitelist</span>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={value.enableRcon}
              onChange={(e) => update("enableRcon", e.target.checked)}
            />
            <span className="text-sm text-gray-800">Enable RCON</span>
          </div>

          {value.enableRcon && (
            <Field label="RCON Password">
              <input
                type="password"
                value={value.rconPassword}
                onChange={(e) => update("rconPassword", e.target.value)}
                className={textInputClass}
              />
            </Field>
          )}
        </div>
      </AccordionSection>

      <AccordionSection
        title="Miscellaneous"
        subtitle="Extra server presentation and network-facing settings."
        defaultOpen={false}
      >
        <div className="space-y-4">
          <Field label="Resource Pack URL">
            <input
              type="text"
              value={value.resourcePack}
              onChange={(e) => update("resourcePack", e.target.value)}
              className={textInputClass}
              placeholder="URL to resource pack"
            />
          </Field>

          <div className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={value.enableStatus}
              onChange={(e) => update("enableStatus", e.target.checked)}
            />
            <span className="text-sm text-gray-800">Enable Server Status</span>
          </div>
        </div>
      </AccordionSection>
    </>
  );
};