/**
 * Settle saved Judge predictions using completed fixtures in match_suggestions.json.
 *
 * For each row with `completed: true` and `result.winner`, calls
 * POST {JUDGE_SERVICE_URL}/predictions/result-by-match (requires JUDGE_SERVICE_SECRET
 * when configured on the Judge service).
 *
 * Only updates predictions that already exist for that match_id — does not invent rows.
 *
 * Usage:
 *   node scripts/settle-predictions-from-catalog.mjs
 *   JUDGE_SERVICE_URL=http://127.0.0.1:8000 node scripts/settle-predictions-from-catalog.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const JSON_PATH = path.join(REPO_ROOT, "match_suggestions.json");

const JUDGE_URL = (process.env.JUDGE_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const JUDGE_SECRET = (process.env.JUDGE_SERVICE_SECRET || "").trim();

/** @param {string} label @param {string} winner */
async function settleMatch(label, winner) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (JUDGE_SECRET) {
    headers.Authorization = `Bearer ${JUDGE_SECRET}`;
    headers["X-Judge-Secret"] = JUDGE_SECRET;
  }
  const res = await fetch(`${JUDGE_URL}/predictions/result-by-match`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      match_id: label,
      actual_winner: winner,
      only_latest: true,
    }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* */
  }
  return { status: res.status, data, text };
}

const raw = fs.readFileSync(JSON_PATH, "utf8");
const rows = JSON.parse(raw);
if (!Array.isArray(rows)) {
  console.error("match_suggestions.json must be an array");
  process.exit(1);
}

let settled = 0;
let skipped = 0;
let errors = 0;

for (const row of rows) {
  if (!row || row.completed !== true || !row.result) continue;
  const label = String(row.label || "").trim();
  const winner = String(row.result.winner || "").trim();
  if (!label || !winner) continue;

  const { status, data, text } = await settleMatch(label, winner);
  if (status === 200 && data && Number(data.updated_rows) > 0) {
    settled += Number(data.updated_rows);
    console.log(`settled: ${label} → ${winner} (${data.updated_rows} row(s))`);
  } else if (status === 404) {
    skipped += 1;
  } else {
    errors += 1;
    console.warn(`failed [${status}] ${label}: ${text.slice(0, 200)}`);
  }
}

console.log(`Done. Settled rows: ${settled}, fixtures with no prediction: ${skipped}, errors: ${errors}`);
