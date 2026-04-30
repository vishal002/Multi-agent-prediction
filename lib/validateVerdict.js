/**
 * Server-side Judge-shaped verdict checks (0–100 confidence model).
 * @param {Record<string, unknown>} output
 * @param {string} teamA
 * @param {string} teamB
 */
export function validateVerdict(output, teamA, teamB) {
  const validTeams = [String(teamA || "").trim(), String(teamB || "").trim()].filter(Boolean);
  const w = String(output.winner || "").trim();
  const winNorm = w.toLowerCase();
  const matchTeam = validTeams.some(
    (t) => t && (winNorm === t.toLowerCase() || winNorm === t.slice(0, 3).toLowerCase())
  );
  if (validTeams.length >= 2 && w && !matchTeam) {
    const err = new Error("invalid_winner");
    /** @type {Error & { code?: string }} */ (err).code = "invalid_winner";
    throw err;
  }

  let c = Number(output.confidence);
  if (!Number.isFinite(c)) c = 55;
  c = Math.min(95, Math.max(35, c));
  output.confidence = c;

  const band = /** @type {{ min?: number, max?: number }} */ (output.score_band || {});
  if (typeof band.min === "number" && typeof band.max === "number" && band.min > band.max) {
    const err = new Error("invalid_score_band");
    /** @type {Error & { code?: string }} */ (err).code = "invalid_score_band";
    throw err;
  }

  const required = ["winner", "confidence", "key_player", "swing_factor"];
  for (const f of required) {
    if (output[f] == null || output[f] === "") {
      const err = new Error(`missing_field:${f}`);
      /** @type {Error & { code?: string }} */ (err).code = "missing_field";
      throw err;
    }
  }
  return output;
}
