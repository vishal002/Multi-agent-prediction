import { createHash } from "node:crypto";
import { redis, TTL } from "./redis.js";

/**
 * @param {string} matchId
 * @param {string | number} runs
 * @param {string | number} wickets
 * @param {string | number} overs
 */
export function matchStateKey(matchId, runs, wickets, overs) {
  const hash = createHash("md5")
    .update(`${runs}-${wickets}-${overs}`)
    .digest("hex")
    .slice(0, 8);
  return `warroom:${matchId}:${hash}`;
}

/**
 * @param {string} key
 * @param {number} ttlSec
 * @param {() => Promise<unknown>} fetchFn
 */
export async function withCache(key, ttlSec, fetchFn) {
  const r = redis;
  if (!r) return fetchFn();
  const cached = await r.get(key);
  if (cached != null) {
    try {
      return typeof cached === "string" ? JSON.parse(cached) : cached;
    } catch {
      return fetchFn();
    }
  }
  const fresh = await fetchFn();
  await r.set(key, JSON.stringify(fresh), { ex: ttlSec });
  return fresh;
}

export { TTL };
