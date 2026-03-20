import React, { createContext, useContext, useEffect, useState } from "react";

type BackupState = {
  active: boolean;
  percent: number;
  label: string;
};

const BackupContext = createContext<BackupState | null>(null);

export function BackupProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [percent, setPercent] = useState(0);
  const [label, setLabel] = useState("");

const safeElectronAPI = window.electronAPI ?? {
  onBackupProgress: () => {},
  // ide tehetsz minden más metódust is, amit hívsz
  backupServer: () => Promise.resolve(),
  downloadBackupFromDrive: () => Promise.resolve(),
  // stb.
};

useEffect(() => {
  const unsub = safeElectronAPI.onBackupProgress(
    ({ uploaded, total, percent }) => {
      // Ha 100% vagy több, befejezettnek tekintjük
	if (percent >= 100) {
	  setTimeout(() => {
	    setActive(false);
	    setPercent(0);
	    setLabel("");
	  }, 1000); // 1 másodperc
	  return;
	}

      setActive(true);
      setPercent(percent);

      const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
      setLabel(`${mb(uploaded)} MB / ${mb(total)} MB`);
    }
  );

  return unsub;
}, []);


  return (
    <BackupContext.Provider value={{ active, percent, label }}>
      {children}
    </BackupContext.Provider>
  );
}

export function useBackup() {
  const ctx = useContext(BackupContext);
  if (!ctx) throw new Error("useBackup must be used inside BackupProvider");
  return ctx;
}
