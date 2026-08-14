import { join } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";
import { createLogger } from "../logger";

const log = createLogger("health:checkpoint");

const OPENCROW_STATE = join(homedir(), ".opencrow");
const KNOWN_GOOD_PATH = join(OPENCROW_STATE, "known-good-commit");

export async function recordKnownGoodCommit(): Promise<void> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const commit = (await new Response(proc.stdout).text()).trim();
  const exitCode = await proc.exited;

  if (exitCode !== 0 || !commit) {
    log.warn("Could not determine current git commit");
    return;
  }

  if (!/^[0-9a-f]{40}$/.test(commit)) {
    log.warn("Unexpected git rev-parse output", { commit });
    return;
  }

  await mkdir(OPENCROW_STATE, { recursive: true });
  await Bun.write(KNOWN_GOOD_PATH, commit);
  log.info("Recorded known-good commit", { commit: commit.slice(0, 8) });
}
