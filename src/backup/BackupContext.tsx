import React, { createContext, useContext, useEffect, useRef, useState } from "react";

type BackupUiStatus = "idle" | "running" | "done" | "error";

type BackupState = {
  active: boolean;
  status: BackupUiStatus;
  phase: string;
  percent: number;
  title: string;
  detail: string;
};

const BackupContext = createContext<BackupState | null>(null);

export function BackupProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BackupState>({
    active: false,
    status: "idle",
    phase: "idle",
    percent: 0,
    title: "",
    detail: "",
  });

  const hideTimerRef = useRef<number | null>(null);
  const safeElectronAPI = window.electronAPI;

  useEffect(() => {
    const clearHideTimer = () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const unsub = safeElectronAPI.onBackupProgress((payload: any) => {
      clearHideTimer();

      const phase = String(payload?.phase || "uploading");
      const percentRaw = Number(payload?.percent ?? 0);
      const percent = Number.isFinite(percentRaw)
        ? Math.max(0, Math.min(100, Math.round(percentRaw)))
        : 0;

      const title =
        typeof payload?.title === "string" && payload.title.trim()
          ? payload.title
          : "Backup";

      const detail =
        typeof payload?.detail === "string"
          ? payload.detail
          : (() => {
              const uploaded = Number(payload?.uploaded ?? 0);
              const total = Number(payload?.total ?? 0);

              if (total > 0) {
                const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
                return `${mb(uploaded)} MB / ${mb(total)} MB`;
              }

              return typeof payload?.message === "string" ? payload.message : "";
            })();

      const isDone = phase === "done";
      const isError = phase === "error";

      setState({
        active: true,
        status: isError ? "error" : isDone ? "done" : "running",
        phase,
        percent: isDone ? 100 : percent,
        title,
        detail,
      });

      if (isDone || isError) {
        hideTimerRef.current = window.setTimeout(() => {
          setState({
            active: false,
            status: "idle",
            phase: "idle",
            percent: 0,
            title: "",
            detail: "",
          });
        }, isError ? 4000 : 1800);
      }
    });

    return () => {
      clearHideTimer();
      unsub?.();
    };
  }, [safeElectronAPI]);

  return (
    <BackupContext.Provider value={state}>
      {children}
    </BackupContext.Provider>
  );
}

export function useBackup() {
  const ctx = useContext(BackupContext);
  if (!ctx) throw new Error("useBackup must be used inside BackupProvider");
  return ctx;
}