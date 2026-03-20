import React, { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  LinearProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

type MetricRow = {
  serverId: string;
  serverName?: string;
  pid: number | null;
  cpu: number;
  memoryMb: number;
  ram: string;
  port: number;
  startedAt: number;
  uptimeSec: number;
  status: string;
};

type MetricPoint = {
  t: number;
  cpu: number;
  memoryMb: number;
};

type ServerHistoryMap = Record<string, MetricPoint[]>;
type ServerNameMap = Record<string, string>;
type HistoryWindowMinutes = 3 | 6 | 9;

const POLL_MS = 1500;

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getLiveUptimeSec(startedAt: number, status: string, fallbackUptimeSec: number, nowMs: number) {
  if (!startedAt || status.toLowerCase() !== "running") {
    return fallbackUptimeSec;
  }

  return Math.max(0, Math.floor((nowMs - startedAt) / 1000));
}

function formatClockTime(timestamp: number) {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function parseRamToMb(ram: string): number {
  if (!ram) return 0;

  const cleaned = ram.trim().toUpperCase();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([MG])B?$/);

  if (!match) return 0;

  const value = Number(match[1]);
  const unit = match[2];

  if (Number.isNaN(value)) return 0;

  return unit === "G" ? value * 1024 : value;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildPath(
  values: number[],
  width: number,
  height: number,
  minValue: number,
  maxValue: number
) {
  if (values.length === 0) return "";

  const range = Math.max(maxValue - minValue, 1);

  return values
    .map((value, index) => {
      const x =
        values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const normalized = (value - minValue) / range;
      const y = height - normalized * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function StatusDot({ status }: { status: string }) {
  const online = status.toLowerCase() === "running";

  return (
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: online ? "#39d98a" : "#ffb020",
        boxShadow: online
          ? "0 0 8px rgba(57,217,138,0.45)"
          : "0 0 8px rgba(255,176,32,0.35)",
        flexShrink: 0,
      }}
    />
  );
}

function InlineMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "baseline",
        gap: 0.55,
        minWidth: 0,
        whiteSpace: "nowrap",
      }}
    >
      <Typography
        sx={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "rgba(210,220,235,0.42)",
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 12.5,
          fontWeight: 700,
          color: "#eaf2ff",
          fontFamily:
            '"IBM Plex Mono","JetBrains Mono","Fira Code","Consolas","monospace"',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function ChartPanel({
  title,
  unit,
  values,
  timestamps,
  max,
  nowValue,
  peakValue,
  height = 118,
}: {
  title: string;
  unit: string;
  values: number[];
  timestamps: number[];
  max: number;
  nowValue: number;
  peakValue: number;
  height?: number;
}) {
  const width = 760;
  const safeMax = Math.max(max, 1);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const linePath = useMemo(
    () => buildPath(values, width, height, 0, safeMax),
    [values, width, height, safeMax]
  );

  function getPoint(index: number) {
    const x =
      values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
    const normalized = values[index] / safeMax;
    const y = height - normalized * height;
    return { x, y };
  }

  function handleMove(
    event: React.MouseEvent<SVGSVGElement, MouseEvent>
  ) {
    if (values.length === 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = rect.width > 0 ? x / rect.width : 0;
    const index = clamp(
      Math.round(ratio * Math.max(values.length - 1, 0)),
      0,
      Math.max(values.length - 1, 0)
    );
    setHoverIndex(index);
  }

  const hovered =
    hoverIndex !== null && values[hoverIndex] !== undefined
      ? {
          index: hoverIndex,
          value: values[hoverIndex],
          time: timestamps[hoverIndex],
          ...getPoint(hoverIndex),
        }
      : null;

  const tooltipWidth = 124;
  const tooltipHeight = 52;
  const tooltipGap = 10;

  const tooltipPosition = hovered
    ? (() => {
        const preferLeft = hovered.x > width * 0.72;

        let left = preferLeft
          ? hovered.x - tooltipWidth - tooltipGap
          : hovered.x + tooltipGap;

        let top = hovered.y - tooltipHeight - 8;

        left = clamp(left, 8, width - tooltipWidth - 8);
        top = clamp(top, 8, height - tooltipHeight - 8);

        return { left, top };
      })()
    : null;

  return (
    <Box
      sx={{
        border: "1px solid rgba(160,180,210,0.10)",
        borderRadius: 1.75,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.012) 100%)",
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          px: 1,
          py: 0.65,
          borderBottom: "1px solid rgba(160,180,210,0.08)",
          background: "rgba(255,255,255,0.015)",
        }}
      >
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0.9,
            color: "#dbe6f7",
          }}
        >
          {title}
        </Typography>

        <Stack direction="row" spacing={1.2} useFlexGap flexWrap="wrap">
          <InlineMetric label="now" value={`${nowValue.toFixed(1)}${unit}`} />
          <InlineMetric label="peak" value={`${peakValue.toFixed(1)}${unit}`} />
          <InlineMetric
            label="samples"
            value={String(values.length)}
          />
        </Stack>
      </Stack>

      <Box
        sx={{
          position: "relative",
          height,
          px: 0.75,
          py: 0.6,
          background:
            "repeating-linear-gradient(to bottom, rgba(255,255,255,0.045) 0, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 24px)",
        }}
      >
        {values.length === 0 ? (
          <Box
            sx={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(220,230,245,0.38)",
              fontSize: 12,
            }}
          >
            Waiting for samples...
          </Box>
        ) : (
          <>
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              onMouseMove={handleMove}
              onMouseLeave={() => setHoverIndex(null)}
              style={{ display: "block", cursor: "crosshair" }}
            >
              <path
                d={linePath}
                fill="none"
                stroke="rgba(229,239,255,0.92)"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {hovered && (
                <>
                  <line
                    x1={hovered.x}
                    y1={0}
                    x2={hovered.x}
                    y2={height}
                    stroke="rgba(120,180,255,0.45)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={hovered.x}
                    cy={hovered.y}
                    r="3.4"
                    fill="#eaf2ff"
                    stroke="rgba(120,180,255,0.9)"
                    strokeWidth="1.2"
                  />
                </>
              )}
            </svg>

            {hovered && tooltipPosition && (
              <Box
                sx={{
                  position: "absolute",
                  left: `${(tooltipPosition.left / width) * 100}%`,
                  top: `${(tooltipPosition.top / height) * 100}%`,
                  width: `${tooltipWidth}px`,
                  minHeight: `${tooltipHeight}px`,
                  px: 0.9,
                  py: 0.65,
                  borderRadius: 1.25,
                  border: "1px solid rgba(140,170,210,0.22)",
                  background: "rgba(8,12,18,0.98)",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.42)",
                  pointerEvents: "none",
                  zIndex: 20,
                  overflow: "hidden",
                }}
              >
                <Typography
                  sx={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "#eaf2ff",
                    lineHeight: 1.1,
                    fontFamily:
                      '"IBM Plex Mono","JetBrains Mono","Fira Code","Consolas","monospace"',
                  }}
                >
                  {hovered.value.toFixed(1)}
                  {unit}
                </Typography>

                <Typography
                  sx={{
                    mt: 0.28,
                    fontSize: 10.5,
                    color: "rgba(220,230,245,0.58)",
                    lineHeight: 1.1,
                    fontFamily:
                      '"IBM Plex Mono","JetBrains Mono","Fira Code","Consolas","monospace"',
                  }}
                >
                  {formatClockTime(hovered.time)}
                </Typography>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

export default function ServerMetricsWindow() {
  const [servers, setServers] = useState<MetricRow[]>([]);
  const [history, setHistory] = useState<ServerHistoryMap>({});
  const [serverNames, setServerNames] = useState<ServerNameMap>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [historyWindowMinutes, setHistoryWindowMinutes] =
    useState<HistoryWindowMinutes>(6);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const result = await window.electronAPI.getRunningServerMetrics();
        if (!mounted || !result.success) return;

                const nextServers = result.servers ?? [];
        setServers(nextServers);
        setHistory(result.history ?? {});
        setHistoryWindowMinutes(result.historyWindowMinutes ?? 6);

        const missingIds = nextServers
          .map((s) => s.serverId)
          .filter((id) => !serverNames[id]);

        if (missingIds.length > 0) {
          const entries = await Promise.all(
            missingIds.map(async (serverId) => {
              try {
                const snap = await getDoc(doc(db, "servers", serverId));
                if (!snap.exists()) return [serverId, serverId] as const;
                const data = snap.data() as { name?: string; serverName?: string };
                return [serverId, data.name || data.serverName || serverId] as const;
              } catch {
                return [serverId, serverId] as const;
              }
            })
          );

          if (mounted) {
            setServerNames((prev) => {
              const next = { ...prev };
              for (const [id, name] of entries) next[id] = name;
              return next;
            });
          }
        }
      } catch (err) {
        console.error("Failed to load metrics", err);
      }
    }

    load();
    const interval = window.setInterval(load, POLL_MS);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [serverNames]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function handleHistoryWindowChange(
    _event: React.MouseEvent<HTMLElement>,
    nextValue: HistoryWindowMinutes | null
  ) {
    if (!nextValue) return;

    const result = await window.electronAPI.setMetricsHistoryWindow(nextValue);
    if (!result.success) return;

    setHistoryWindowMinutes(nextValue);

    const refreshed = await window.electronAPI.getRunningServerMetrics();
    if (!refreshed.success) return;

    setServers(refreshed.servers ?? []);
    setHistory(refreshed.history ?? {});
    setHistoryWindowMinutes(refreshed.historyWindowMinutes ?? nextValue);
  }

  const sortedServers = useMemo(
    () =>
      [...servers].sort((a, b) => {
        const aLabel = (serverNames[a.serverId] || a.serverName || a.serverId).toLowerCase();
        const bLabel = (serverNames[b.serverId] || b.serverName || b.serverId).toLowerCase();
        return aLabel.localeCompare(bLabel);
      }),
    [servers, serverNames]
  );

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #06090d 0%, #0b1016 100%)",
        color: "#fff",
        p: 1,
        fontFamily: '"Inter", "Segoe UI", sans-serif',
      }}
    >
      <Box
        sx={{
          mb: 0.8,
          px: 1.1,
          py: 0.7,
          borderRadius: 1.6,
          border: "1px solid rgba(150,170,200,0.10)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.018) 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >

        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#39d98a",
              boxShadow: "0 0 8px rgba(57,217,138,0.45)",
            }}
          />
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.9,
              textTransform: "uppercase",
              color: "#eaf2ff",
            }}
          >
            Performance Monitor
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap flexWrap="wrap">
          <ToggleButtonGroup
            exclusive
            size="small"
            value={historyWindowMinutes}
            onChange={handleHistoryWindowChange}
            sx={{
              height: 26,
              "& .MuiToggleButton-root": {
                px: 1,
                py: 0.2,
                color: "rgba(220,230,245,0.62)",
                border: "1px solid rgba(150,170,200,0.12)",
                background: "rgba(255,255,255,0.02)",
                fontSize: 11,
                fontWeight: 700,
                fontFamily:
                  '"IBM Plex Mono","JetBrains Mono","Fira Code","Consolas","monospace"',
                textTransform: "none",
              },
              "& .Mui-selected": {
                color: "#eaf2ff !important",
                background: "rgba(147,197,253,0.10) !important",
              },
            }}
          >
            <ToggleButton value={3}>3m</ToggleButton>
            <ToggleButton value={6}>6m</ToggleButton>
            <ToggleButton value={9}>9m</ToggleButton>
          </ToggleButtonGroup>

          <InlineMetric label="running" value={String(sortedServers.length)} />
          <InlineMetric label="range" value={`${historyWindowMinutes}m`} />
          <InlineMetric label="refresh" value={`${(POLL_MS / 1000).toFixed(1)}s`} />
        </Stack>
      </Box>

      {sortedServers.length === 0 ? (
        <Box
          sx={{
            px: 1.2,
            py: 1.4,
            borderRadius: 1.8,
            border: "1px solid rgba(150,170,200,0.10)",
            background: "rgba(255,255,255,0.018)",
          }}
        >
          <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#eaf2ff" }}>
            No running servers
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: "rgba(220,230,245,0.48)" }}>
            Start a hosted server and live metrics will appear here.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0.55}>
          {sortedServers.map((server) => {
            const maxRamMb = parseRamToMb(server.ram);
            const ramUsagePercent =
              maxRamMb > 0 ? clamp((server.memoryMb / maxRamMb) * 100, 0, 100) : 0;

            const series = history[server.serverId] ?? [];
            const cpuValues = series.map((p) => p.cpu);
            const memoryValues = series.map((p) => p.memoryMb);
            const timestamps = series.map((p) => p.t);

            const peakCpu = cpuValues.length ? Math.max(...cpuValues) : server.cpu;
            const peakMemory = memoryValues.length
              ? Math.max(...memoryValues)
              : server.memoryMb;

            const isExpanded = expanded.includes(server.serverId);
            const displayName =
              serverNames[server.serverId] || server.serverName || server.serverId;
            const liveUptimeSec = getLiveUptimeSec(
              server.startedAt,
              server.status,
              server.uptimeSec,
              nowMs
            );

            return (
              <Accordion
                key={server.serverId}
                expanded={isExpanded}
                onChange={(_, nextExpanded) => {
		  setExpanded((prev) => {
		    if (nextExpanded) {
		      return prev.includes(server.serverId)
		        ? prev
		        : [...prev, server.serverId];
		    }
		
		    return prev.filter((id) => id !== server.serverId);
		  });
		}}

                disableGutters
                elevation={0}
                sx={{
                  background: "rgba(255,255,255,0.018)",
                  border: "1px solid rgba(150,170,200,0.10)",
                  borderRadius: "12px !important",
                  overflow: "hidden",
                  "&:before": { display: "none" },
                }}
              >
                <AccordionSummary
                  expandIcon={
                    <ExpandMoreIcon
                      sx={{
                        color: "rgba(220,230,245,0.72)",
                        fontSize: 20,
                      }}
                    />
                  }
                  sx={{
                    minHeight: "unset !important",
                    px: 1,
                    py: 0.45,
                    "& .MuiAccordionSummary-content": {
                      margin: "0 !important",
                    },
                  }}
                >
                  <Box sx={{ width: "100%" }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ minWidth: 0 }}
                    >
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={0.75}
                        sx={{ minWidth: 180, maxWidth: 320 }}
                      >
                        <StatusDot status={server.status} />
                        <Typography
                          sx={{
                            fontSize: 13.5,
                            fontWeight: 700,
                            color: "#eaf2ff",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={displayName}
                        >
                          {displayName}
                        </Typography>
                      </Stack>

                      <Typography
                        sx={{
                          fontSize: 11.5,
                          color: "rgba(220,230,245,0.50)",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                          fontFamily:
                            '"IBM Plex Mono","JetBrains Mono","Fira Code","Consolas","monospace"',
                        }}
                      >
                        :{server.port}
                      </Typography>

                      <Typography
                        sx={{
                          fontSize: 11.5,
                          color: "rgba(220,230,245,0.42)",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                          fontFamily:
                            '"IBM Plex Mono","JetBrains Mono","Fira Code","Consolas","monospace"',
                        }}
                      >
                        {formatUptime(liveUptimeSec)}
                      </Typography>

                      <Box sx={{ flex: 1, minWidth: 120 }}>
                        <LinearProgress
                          variant="determinate"
                          value={ramUsagePercent}
                          sx={{
                            height: 4,
                            borderRadius: 999,
                            backgroundColor: "rgba(255,255,255,0.065)",
                            "& .MuiLinearProgress-bar": {
                              borderRadius: 999,
                              background:
                                "linear-gradient(90deg, #93c5fd 0%, #dbeafe 100%)",
                            },
                          }}
                        />
                      </Box>

                      <Typography
                        sx={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: "#eaf2ff",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                          minWidth: 126,
                          textAlign: "right",
                          fontFamily:
                            '"IBM Plex Mono","JetBrains Mono","Fira Code","Consolas","monospace"',
                        }}
                      >
                        {server.memoryMb.toFixed(0)} / {maxRamMb > 0 ? maxRamMb.toFixed(0) : server.ram} MB
                      </Typography>
                    </Stack>
                  </Box>
                </AccordionSummary>

                <AccordionDetails
                  sx={{
                    px: 1,
                    pb: 0.95,
                    pt: 0,
                    borderTop: "1px solid rgba(150,170,200,0.08)",
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,0.014) 0%, rgba(255,255,255,0.008) 100%)",
                  }}
                >
                  <Stack spacing={0.8}>
                    <Stack
                      direction="row"
                      spacing={1.15}
                      useFlexGap
                      flexWrap="wrap"
                      sx={{ pt: 0.65 }}
                    >
                      <InlineMetric label="status" value={server.status} />
                      <InlineMetric label="pid" value={server.pid ? String(server.pid) : "-"} />
                      <InlineMetric label="cpu" value={`${server.cpu.toFixed(1)}%`} />
                      <InlineMetric label="cpu peak" value={`${peakCpu.toFixed(1)}%`} />
                      <InlineMetric label="memory" value={`${server.memoryMb.toFixed(1)} MB`} />
                      <InlineMetric label="memory peak" value={`${peakMemory.toFixed(1)} MB`} />
                      <InlineMetric label="ram" value={server.ram} />
                      <InlineMetric label="samples" value={String(series.length)} />
                    </Stack>

                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                        gap: 0.85,
                      }}
                    >
                      <ChartPanel
                        title="CPU"
                        unit="%"
                        values={cpuValues}
                        timestamps={timestamps}
                        max={100}
                        nowValue={server.cpu}
                        peakValue={peakCpu}
                      />

                      <ChartPanel
                        title="Memory"
                        unit=" MB"
                        values={memoryValues}
                        timestamps={timestamps}
                        max={Math.max(maxRamMb || 1, peakMemory + 128)}
                        nowValue={server.memoryMb}
                        peakValue={peakMemory}
                      />
                    </Box>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}