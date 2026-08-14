import path from "node:path";
import { resolveService } from "../daemon/service.ts";
import type { ServiceName } from "../daemon/types.ts";
import type { ServiceRuntime } from "../daemon/types.ts";

const APP_DIR = path.resolve(import.meta.dir, "..", "..");
const GUARDIAN_CORE = path.join(APP_DIR, "bin", "guardian.sh");
const GUARDIAN_WEB = path.join(APP_DIR, "bin", "guardian-web.sh");

function readWebPort(): number {
  const fromEnv = Number(process.env.OPENCROW_WEB_PORT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 48080;
}
const ENV_FILE = path.join(APP_DIR, ".env");

function printStatus(label: string, runtime: ServiceRuntime): void {
  const icon =
    runtime.status === "running"
      ? "●"
      : runtime.status === "stopped"
        ? "○"
        : "?";
  const status = runtime.status.toUpperCase();
  process.stdout.write(`${icon} OpenCrow ${label} — ${status}\n`);
  if (runtime.state)
    process.stdout.write(
      `  State:    ${runtime.state}${runtime.subState ? ` (${runtime.subState})` : ""}\n`,
    );
  if (runtime.pid) process.stdout.write(`  PID:      ${runtime.pid}\n`);
  if (runtime.lastExitStatus !== undefined)
    process.stdout.write(
      `  Last exit: ${runtime.lastExitStatus} (${runtime.lastExitReason ?? "unknown"})\n`,
    );
  if (runtime.detail) process.stdout.write(`  Detail:   ${runtime.detail}\n`);
}

function getGuardianScript(name: ServiceName): string {
  return name === "web" ? GUARDIAN_WEB : GUARDIAN_CORE;
}

export async function runServiceCommand(
  subcommand: string,
  serviceName: ServiceName = "core",
): Promise<void> {
  const service = resolveService(serviceName);
  const stdout = process.stdout;
  const label = serviceName === "web" ? "Web" : "Core";

  switch (subcommand) {
    case "install": {
      const installed = await service.isInstalled();
      if (installed) {
        stdout.write(
          `OpenCrow ${label} ${service.label} is already installed. Use "reinstall" to overwrite.\n`,
        );
        return;
      }
      stdout.write(
        `Installing OpenCrow ${label} as a ${service.label} service...\n`,
      );
      await service.install({
        programArguments: ["/bin/bash", getGuardianScript(serviceName)],
        workingDirectory: APP_DIR,
        environmentFile: ENV_FILE,
        port: serviceName === "web" ? readWebPort() : undefined,
        stdout,
      });
      stdout.write(`OpenCrow ${label} will start automatically on boot.\n`);
      break;
    }

    case "reinstall": {
      stdout.write(
        `Reinstalling OpenCrow ${label} as a ${service.label} service...\n`,
      );
      await service.install({
        programArguments: ["/bin/bash", getGuardianScript(serviceName)],
        workingDirectory: APP_DIR,
        environmentFile: ENV_FILE,
        port: serviceName === "web" ? readWebPort() : undefined,
        stdout,
      });
      stdout.write(`OpenCrow ${label} will start automatically on boot.\n`);
      break;
    }

    case "uninstall": {
      stdout.write(`Uninstalling OpenCrow ${label} ${service.label} service...\n`);
      await service.uninstall({ stdout });
      break;
    }

    case "start": {
      await service.start({ stdout });
      break;
    }

    case "stop": {
      await service.stop({ stdout });
      break;
    }

    case "restart": {
      await service.restart({ stdout });
      break;
    }

    case "status": {
      const runtime = await service.status();
      printStatus(label, runtime);
      if (runtime.status !== "running") process.exit(1);
      break;
    }

    default:
      process.stderr.write(`Unknown service command: ${subcommand}\n`);
      process.stderr.write(
        "Usage: opencrow service [core|web] <install|reinstall|uninstall|start|stop|restart|status>\n",
      );
      process.exit(1);
  }
}
