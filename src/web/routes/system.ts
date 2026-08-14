import { Hono } from "hono";
import * as os from "os";
import { createLogger } from "../../logger";

const logger = createLogger("web");

export const systemRoutes = new Hono();

interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  memoryMB: number;
}

interface DiskInfo {
  filesystem: string;
  mount: string;
  total: number;
  used: number;
  available: number;
  percentage: number;
}

interface CpuSnapshot {
  readonly idle: number;
  readonly total: number;
}

let previousCpuSnapshot: CpuSnapshot | null = null;

async function spawnText(cmd: readonly string[], timeoutMs = 5_000): Promise<string | null> {
  try {
    const proc = Bun.spawn([...cmd], {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]).finally(() => clearTimeout(timer));
    if (timedOut || exitCode !== 0) return null;
    return stdout;
  } catch {
    return null;
  }
}

function readCpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
}

function parseJsonArray<T>(text: string | null): T[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text.trim()) as T | T[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function getSystemMetrics() {
  // Get CPU usage
  const cpuUsage = await getCPUUsage();

  // Get accurate memory info from /proc/meminfo
  const memInfo = await getDetailedMemoryInfo();

  // Get load average
  const loadAvg = os.loadavg();

  // Get top processes
  const processes = await getTopProcesses();

  // Get disk usage
  const disk = await getDiskUsage();

  return {
    timestamp: Date.now(),
    cpu: {
      usage: cpuUsage,
      loadAvg: loadAvg as [number, number, number],
    },
    memory: {
      total: memInfo.total,
      used: memInfo.used,
      free: memInfo.free,
      available: memInfo.available,
      buffers: memInfo.buffers,
      cached: memInfo.cached,
      percentage: (memInfo.used / memInfo.total) * 100,
    },
    disk,
    processes,
  };
}

async function getCPUUsage(): Promise<number> {
  const current = readCpuSnapshot();
  const previous = previousCpuSnapshot;
  previousCpuSnapshot = current;

  if (previous) {
    const idleDelta = current.idle - previous.idle;
    const totalDelta = current.total - previous.total;
    if (totalDelta > 0) {
      return Math.max(0, Math.min(100, 100 - (idleDelta / totalDelta) * 100));
    }
  }

  const idlePct = current.total > 0 ? (current.idle / current.total) * 100 : 0;
  return Math.max(0, Math.min(100, 100 - idlePct));
}

async function getDetailedMemoryInfo(): Promise<{
  total: number;
  free: number;
  available: number;
  used: number;
  buffers: number;
  cached: number;
}> {
  if (process.platform === "win32") {
    const total = os.totalmem();
    const free = os.freemem();
    return {
      total,
      free,
      available: free,
      used: total - free,
      buffers: 0,
      cached: 0,
    };
  }

  try {
    const stdout = await spawnText(["cat", "/proc/meminfo"]);
    if (!stdout) throw new Error("meminfo unavailable");
    const lines = stdout.split("\n");
    const memInfo: any = {};

    lines.forEach((line) => {
      const [key, value] = line.split(":");
      if (key && value) {
        const kb = parseInt(value.trim().split(" ")[0] ?? "0");
        memInfo[key] = kb * 1024; // Convert to bytes
      }
    });

    // Calculate actual used memory (excluding buffers/cache)
    // This matches what 'free' command shows as "used"
    const total = memInfo.MemTotal || os.totalmem();
    const free = memInfo.MemFree || os.freemem();
    const available = memInfo.MemAvailable || free;
    const buffers = memInfo.Buffers || 0;
    const cached = memInfo.Cached || 0;
    const sReclaimable = memInfo.SReclaimable || 0;

    // Used memory = Total - Free - Buffers - Cached - SReclaimable
    // This gives us the actual memory used by applications
    const used = total - free - buffers - cached - sReclaimable;

    return {
      total,
      free,
      available,
      used,
      buffers,
      cached,
    };
  } catch (error) {
    logger.warn("Error reading meminfo", { error: error instanceof Error ? error.message : String(error) });
    // Fallback to OS methods
    const total = os.totalmem();
    const free = os.freemem();
    return {
      total,
      free,
      available: free,
      used: total - free,
      buffers: 0,
      cached: 0,
    };
  }
}

async function getTopProcesses(): Promise<ProcessInfo[]> {
  if (process.platform === "win32") {
    const output = await spawnText([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 20 Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress",
    ], 8_000);
    const rows = parseJsonArray<{
      readonly Id?: number;
      readonly ProcessName?: string;
      readonly CPU?: number;
      readonly WorkingSet64?: number;
    }>(output);

    const totalMemory = os.totalmem();
    return rows
      .filter((row) => row.Id !== undefined && row.ProcessName)
      .map((row) => {
        const memoryBytes = Number(row.WorkingSet64 ?? 0);
        return {
          pid: Number(row.Id),
          name: String(row.ProcessName).slice(0, 32),
          cpu: Math.max(0, Math.min(100, Number(row.CPU ?? 0))),
          memory: totalMemory > 0 ? (memoryBytes / totalMemory) * 100 : 0,
          memoryMB: memoryBytes / 1024 / 1024,
        };
      });
  }

  try {
    // Get top processes by CPU and memory
    const stdout = await spawnText(
      [
        "sh",
        "-lc",
        "ps aux --sort=-%cpu,-%mem | head -20 | awk 'NR>1 {print $2 \"|\" $11 \"|\" $3 \"|\" $4 \"|\" $6}'",
      ],
    );
    if (!stdout) throw new Error("process list unavailable");

    const processes: ProcessInfo[] = [];
    const lines = stdout.trim().split("\n");

    for (const line of lines) {
      const [pid, name, cpu, mem, rss] = line.split("|");
      if (pid && name) {
        // Extract just the process name from the full command
        const processName = name.split("/").pop()?.split(" ")[0] || name;

        processes.push({
          pid: parseInt(pid),
          name: processName.substring(0, 20), // Limit name length
          cpu: parseFloat(cpu ?? "0") || 0,
          memory: parseFloat(mem ?? "0") || 0,
          memoryMB: parseInt(rss ?? "0") / 1024, // RSS is in KB, convert to MB
        });
      }
    }

    return processes;
  } catch (error) {
    logger.warn("Error getting processes", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

async function getDiskUsage(): Promise<DiskInfo[]> {
  if (process.platform === "win32") {
    const output = await spawnText([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,FileSystem,Size,FreeSpace | ConvertTo-Json -Compress",
    ], 8_000);
    const rows = parseJsonArray<{
      readonly DeviceID?: string;
      readonly FileSystem?: string;
      readonly Size?: number;
      readonly FreeSpace?: number;
    }>(output);

    return rows
      .filter((row) => Number(row.Size ?? 0) > 0)
      .map((row, index) => {
        const total = Number(row.Size ?? 0);
        const available = Number(row.FreeSpace ?? 0);
        const used = Math.max(0, total - available);
        const diskLabel = `本地磁盘 ${index + 1}`;
        return {
          filesystem: row.FileSystem || "本地磁盘",
          mount: diskLabel,
          total,
          used,
          available,
          percentage: total > 0 ? (used / total) * 100 : 0,
        };
      });
  }

  try {
    // -P for POSIX output, -x to exclude pseudo filesystems
    const stdout = await spawnText(
      [
        "sh",
        "-lc",
        "df -P -k 2>/dev/null | awk 'NR>1 && $1 !~ /^(tmpfs|devtmpfs|overlay|shm|udev|none)/ {print $1 \"|\" $6 \"|\" $2 \"|\" $3 \"|\" $4 \"|\" $5}'",
      ],
    );
    if (!stdout) throw new Error("disk usage unavailable");

    const disks: DiskInfo[] = [];
    const lines = stdout.trim().split("\n");

    for (const line of lines) {
      const [filesystem, mount, totalKB, usedKB, availKB, pctStr] =
        line.split("|");
      if (!filesystem || !mount) continue;

      // Skip pseudo/snap mounts
      if (
        mount.startsWith("/snap") ||
        mount.startsWith("/boot/efi") ||
        mount.startsWith("/dev")
      )
        continue;

      disks.push({
        filesystem,
        mount,
        total: parseInt(totalKB ?? "0") * 1024,
        used: parseInt(usedKB ?? "0") * 1024,
        available: parseInt(availKB ?? "0") * 1024,
        percentage: parseFloat(pctStr ?? "0") || 0,
      });
    }

    return disks;
  } catch {
    return [];
  }
}

systemRoutes.get("/metrics", async (c) => {
  try {
    const metrics = await getSystemMetrics();
    return c.json(metrics);
  } catch (error) {
    logger.error("Error fetching system metrics", { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: "Failed to fetch system metrics" }, 500);
  }
});
