import React from "react";

type LiveAdminWindowProps = {
  serverId: string;
  accessToken: string;
};

export default function LiveAdminWindow({ serverId }: LiveAdminWindowProps) {
  const [players, setPlayers] = React.useState<string[]>([]);
  const [selectedPlayer, setSelectedPlayer] = React.useState<string | null>(null);
  const [gamemode, setGamemode] = React.useState("");
  const [broadcastMessage, setBroadcastMessage] = React.useState("");
  const [timeoutMinutes, setTimeoutMinutes] = React.useState("5");
  const [actionBusy, setActionBusy] = React.useState(false);
  const [statusText, setStatusText] = React.useState("");

  const selectionLabel = selectedPlayer ? selectedPlayer : "ALL PLAYERS";
  const targetPlayers = selectedPlayer ? [selectedPlayer] : players;
  const isAllMode = selectedPlayer === null;

  const sendCommand = async (command: string) => {
    const result = await window.electronAPI.sendServerCommand({
      serverId,
      command,
    });

    if (!result.success) {
      throw new Error(result.error || "Command failed");
    }
  };

  React.useEffect(() => {
    window.electronAPI
      .getOnlinePlayers({ serverId })
      .then((res: { success: boolean; players: string[] }) => {
        if (res.success) {
          setPlayers(res.players);
        }
      });

    const unsub = window.electronAPI.onOnlinePlayersChanged(
      (data: { serverId: string; players: string[]; count: number }) => {
        if (data.serverId !== serverId) return;

        setPlayers(data.players);

        setSelectedPlayer((prev) => {
          if (prev === null) return null;
          if (!data.players.length) return null;
          if (prev && data.players.includes(prev)) return prev;
          return null;
        });
      }
    );

    return unsub;
  }, [serverId]);

  const handleGamemodeApply = async () => {
    if (!gamemode) return;
    if (!targetPlayers.length) return;

    try {
      setActionBusy(true);

      for (const player of targetPlayers) {
        await sendCommand(`gamemode ${gamemode} ${player}`);
      }

      setStatusText(
        selectedPlayer
          ? `MODE SET · ${selectedPlayer} · ${gamemode.toUpperCase()}`
          : `MODE SET · ALL PLAYERS · ${gamemode.toUpperCase()}`
      );
    } catch (error) {
      console.error("Failed to set gamemode:", error);
      setStatusText("COMMAND FAILED · MODE");
    } finally {
      setActionBusy(false);
    }
  };

  const handleKick = async () => {
    if (!targetPlayers.length) return;

    try {
      setActionBusy(true);

      for (const player of targetPlayers) {
        await sendCommand(`kick ${player}`);
      }

      setStatusText(
        selectedPlayer
          ? `KICKED · ${selectedPlayer}`
          : `KICKED · ALL PLAYERS`
      );
    } catch (error) {
      console.error("Failed to kick player(s):", error);
      setStatusText("COMMAND FAILED · KICK");
    } finally {
      setActionBusy(false);
    }
  };

  const handleKill = async () => {
    if (!targetPlayers.length) return;

    try {
      setActionBusy(true);

      for (const player of targetPlayers) {
        await sendCommand(`kill ${player}`);
      }

      setStatusText(
        selectedPlayer
          ? `KILLED · ${selectedPlayer}`
          : `KILLED · ALL PLAYERS`
      );
    } catch (error) {
      console.error("Failed to kill player(s):", error);
      setStatusText("COMMAND FAILED · KILL");
    } finally {
      setActionBusy(false);
    }
  };

  const handleTimeout = async () => {
    const minutes = Math.max(1, Number(timeoutMinutes) || 1);
    if (!targetPlayers.length) return;

    try {
      setActionBusy(true);

      const result = await window.electronAPI.timeoutPlayers({
        serverId,
        players: targetPlayers,
        minutes,
        reason: `Temporary timeout (${minutes} min)`,
      });

      if (!result.success) {
        throw new Error(result.error || "Timeout failed");
      }

      setStatusText(
        selectedPlayer
          ? `TIMEOUT · ${selectedPlayer} · ${minutes} MIN`
          : `TIMEOUT · ALL PLAYERS · ${minutes} MIN`
      );
    } catch (error) {
      console.error("Failed to timeout player(s):", error);
      setStatusText("COMMAND FAILED · TIMEOUT");
    } finally {
      setActionBusy(false);
    }
  };

  const handleBroadcast = async () => {
    const text = broadcastMessage.trim();
    if (!text) return;

    try {
      setActionBusy(true);
      await sendCommand(`say ${text}`);
      setBroadcastMessage("");
      setStatusText("BROADCAST SENT");
    } catch (error) {
      console.error("Failed to broadcast:", error);
      setStatusText("COMMAND FAILED · BROADCAST");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050607] text-[#e7eaee] p-0">
      <div className="h-screen w-full border border-[#11151a] bg-[#07090c]">
        <div className="border-b border-[#121820] px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#667180]">
                Restricted Control
              </div>
              <div className="mt-1 text-[26px] font-semibold tracking-tight text-white">
                LIVE ADMIN
              </div>
              <div className="mt-2 truncate text-[11px] uppercase tracking-[0.14em] text-[#46515f]">
                {serverId}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#7e8a99]">
                online
              </div>
              <div className="mt-1 text-[22px] font-semibold text-white">
                {players.length}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#667180]">
              Players
            </div>
            <button
              type="button"
              onClick={() => setSelectedPlayer(null)}
              className={[
                "text-[10px] uppercase tracking-[0.18em] transition",
                isAllMode ? "text-white" : "text-[#46515f] hover:text-[#8b97a6]",
              ].join(" ")}
            >
              all mode
            </button>
          </div>

          <div className="min-h-[260px] max-h-[340px] overflow-y-auto">
            {players.length === 0 ? (
              <div className="py-8 text-[12px] uppercase tracking-[0.18em] text-[#4f5966]">
                No active players
              </div>
            ) : (
              <div className="flex flex-col">
                {players.map((player, index) => {
                  const selected = selectedPlayer === player;

                  return (
                    <button
                      key={player}
                      type="button"
                      onClick={() =>
                        setSelectedPlayer((prev) => (prev === player ? null : player))
                      }
                      className={[
                        "w-full border-b border-[#10151b] px-3 py-3 text-left transition",
                        index === 0 ? "border-t border-[#10151b]" : "",
                        selected
                          ? "bg-[#0f141a] text-white"
                          : "bg-transparent text-[#c7d0da] hover:bg-[#0b0f14]",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-[14px] font-medium tracking-[0.01em]">
                          {player}
                        </span>
                        {selected && (
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[#8e99a8]">
                            selected
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[#121820] px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#667180]">
              Target Control
            </div>
            <div className="truncate text-[10px] uppercase tracking-[0.18em] text-[#9aa4b2]">
              {selectionLabel}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                value={gamemode}
                onChange={(e) => setGamemode(e.target.value)}
                disabled={!targetPlayers.length || actionBusy}
                className="min-w-0 border border-[#1b222b] bg-[#0b0f14] px-3 py-2 text-[13px] text-white outline-none"
              >
                <option value="">Select mode</option>
                <option value="survival">Survival</option>
                <option value="creative">Creative</option>
                <option value="adventure">Adventure</option>
                <option value="spectator">Spectator</option>
              </select>

              <button
                type="button"
                onClick={handleGamemodeApply}
                disabled={!targetPlayers.length || !gamemode || actionBusy}
                className="border border-[#202833] bg-[#10151b] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#151b22] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Apply
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleKick}
                disabled={!targetPlayers.length || actionBusy}
                className="border border-[#202833] bg-[#0f1318] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e7eaee] transition hover:bg-[#151a20] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Kick
              </button>

              <button
                type="button"
                onClick={handleKill}
                disabled={!targetPlayers.length || actionBusy}
                className="border border-[#3a1e24] bg-[#160d10] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f1d1d8] transition hover:bg-[#211215] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Kill
              </button>
            </div>

            <div className="grid grid-cols-[90px_1fr] gap-2">
              <input
                type="number"
                min="1"
                value={timeoutMinutes}
                onChange={(e) => setTimeoutMinutes(e.target.value)}
                disabled={!targetPlayers.length || actionBusy}
                className="min-w-0 border border-[#1b222b] bg-[#0b0f14] px-3 py-2 text-[13px] text-white outline-none"
              />

              <button
                type="button"
                onClick={handleTimeout}
                disabled={!targetPlayers.length || actionBusy}
                className="border border-[#33261b] bg-[#17110b] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3dfc8] transition hover:bg-[#21170f] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Timeout (min)
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-[#121820] px-4 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[#667180]">
            Broadcast
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="text"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder="Transmit message"
              disabled={actionBusy}
              className="min-w-0 border border-[#1b222b] bg-[#0b0f14] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[#4f5966]"
            />

            <button
              type="button"
              onClick={handleBroadcast}
              disabled={!broadcastMessage.trim() || actionBusy}
              className="border border-[#202833] bg-[#10151b] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#151b22] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>

        <div className="border-t border-[#121820] px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-[#667180]">
          {statusText || "Awaiting operator input"}
        </div>
      </div>
    </div>
  );
}