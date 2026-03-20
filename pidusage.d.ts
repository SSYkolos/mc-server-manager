declare module "pidusage" {
  export interface PidUsageStat {
    cpu: number;
    memory: number;
    ctime?: number;
    elapsed?: number;
    timestamp?: number;
    pid?: number;
    ppid?: number;
  }

  function pidusage(pid: number): Promise<PidUsageStat>;
  function pidusage(pids: number[]): Promise<Record<string, PidUsageStat>>;

  export default pidusage;
}