/**
 * Normalize "X vs Y" in IPL 2026 fixture labels to alphabetical order by team code
 * (matches common Google / schedule widget ordering, e.g. KKR vs LSG).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const jsonPath = path.join(root, "match_suggestions.json");
const jsPath = path.join(root, "ai_cricket_war_room.js");

function normalizeRows(rows) {
  for (const row of rows) {
    if (!Array.isArray(row.teams) || row.teams.length !== 2) continue;
    const m = row.label.match(/^(.+?) vs (.+?) — (IPL 2026 .+)$/);
    if (!m) continue;
    const suffix = m[3];
    const [t1, t2] = [...row.teams].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    row.label = `${t1} vs ${t2} — ${suffix}`;
    row.teams = [t1, t2];
  }
  return rows;
}

const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
normalizeRows(data);
fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n");

let js = fs.readFileSync(jsPath, "utf8");
const raw = JSON.stringify(data, null, 2);
const inner = raw
  .substring(1, raw.lastIndexOf("]"))
  .split("\n")
  .map((l) => (l ? `  ${l}` : ""))
  .join("\n");
const block = `const MATCH_SUGGESTIONS_FALLBACK_ROWS = /** @type {MatchSuggestionRow[]} */ ([\n${inner}\n]);`;
const re =
  /const MATCH_SUGGESTIONS_FALLBACK_ROWS = \/\*\* @type \{MatchSuggestionRow\[\]\} \*\/ \(\[[\s\S]*?\n\]\);/;
if (!re.test(js)) {
  console.error("Could not find MATCH_SUGGESTIONS_FALLBACK_ROWS block in ai_cricket_war_room.js");
  process.exit(1);
}
js = js.replace(re, block);
fs.writeFileSync(jsPath, js);
console.log("Updated match_suggestions.json and MATCH_SUGGESTIONS_FALLBACK_ROWS in ai_cricket_war_room.js");
