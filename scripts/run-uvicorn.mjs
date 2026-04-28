/**
 * Cross-platform: `py` on Windows, `python3` / `python` elsewhere.
 * Usage: node scripts/run-uvicorn.mjs <module:app> <port>
 * Example: node scripts/run-uvicorn.mjs ingestion_service.app:app 3334
 */
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const app = process.argv[2];
const port = process.argv[3] || "8000";
if (!app) {
  console.error("Usage: node scripts/run-uvicorn.mjs <module:app> <port>");
  process.exit(1);
}

const candidates =
  process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];

let bin = candidates[0];
for (const c of candidates) {
  const r = spawnSync(c, ["-V"], { stdio: "pipe" });
  if (r.status === 0) {
    bin = c;
    break;
  }
}

const child = spawn(
  bin,
  ["-m", "uvicorn", app, "--host", "127.0.0.1", "--port", port],
  { stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 1));
