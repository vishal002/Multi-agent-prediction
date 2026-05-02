/**
 * IPL live-window daily cap on successful Judge runs (per client IP, IST calendar day).
 * When FREEMIUM_MAX_RUNS_PER_DAY is 0, freemium is disabled.
 */
import { redis, TTL } from "../lib/redis.js";

/** @type {Map<string, number>} key -> count (memory fallback when Redis unset) */
const _memCounts = new Map();

const MAX_RUNS = Math.max(0, Math.floor(Number(process.env.FREEMIUM_MAX_RUNS_PER_DAY) || 5));

const FORCE_ACTIVE =
  process.env.IPL_FREEMIUM_ACTIVE === "1" || process.env.IPL_FREEMIUM_ACTIVE === "true";

/**
 * YYYY-MM-DD in Asia/Kolkata.
 * @returns {string}
 */
export function istCalendarDateYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * @param {{ date: string, completed: boolean }[]} rows normalized match suggestions (server shape)
 * @returns {boolean}
 */
/** Exported for post-judge accounting (only count toward cap during live window). */
export function isFreemiumLiveWindow(rows) {
  if (MAX_RUNS <= 0) return false;
  if (FORCE_ACTIVE) return true;
  const d = istCalendarDateYmd();
  return rows.some((r) => String(r.date || "").trim() === d && !r.completed);
}

/**
 * Redis / memory key for successful judge completions today (IST).
 * @param {string} ip
 * @param {string} istYmd
 */
function runCountKey(ip, istYmd) {
  return `fr:judgeok:${String(ip || "unknown").slice(0, 64)}:${istYmd}`;
}

/**
 * @param {string} ip
 * @returns {Promise<number>}
 */
export async function freemiumSuccessfulRunCount(ip) {
  const ymd = istCalendarDateYmd();
  const key = runCountKey(ip, ymd);
  if (redis) {
    try {
      const v = await redis.get(key);
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  }
  return _memCounts.get(key) || 0;
}

/**
 * @param {string} ip
 * @returns {Promise<void>}
 */
export async function freemiumRecordSuccessfulJudgeRun(ip) {
  if (MAX_RUNS <= 0) return;
  const ymd = istCalendarDateYmd();
  const key = runCountKey(ip, ymd);
  if (redis) {
    try {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, TTL.FREEMIUM_RUN);
    } catch {
      /* */
    }
    return;
  }
  _memCounts.set(key, (_memCounts.get(key) || 0) + 1);
}

/**
 * True when the next war-room LLM/Judge work should be blocked (live window + at cap).
 * @param {string} ip
 * @param {{ date: string, completed: boolean }[]} catalogRows
 * @returns {Promise<boolean>}
 */
export async function freemiumShouldBlock(ip, catalogRows) {
  if (MAX_RUNS <= 0) return false;
  if (!isFreemiumLiveWindow(catalogRows)) return false;
  const c = await freemiumSuccessfulRunCount(ip);
  return c >= MAX_RUNS;
}

/**
 * @param {{ date: string, completed: boolean }[]} catalogRows
 * @param {string} ip
 * @returns {Promise<{ enabled: boolean, live_window: boolean, limit: number, used: number, remaining: number, ist_date: string }>}
 */
export async function freemiumStatusPayload(catalogRows, ip) {
  const ist_date = istCalendarDateYmd();
  const enabled = MAX_RUNS > 0;
  const live_window = enabled && isFreemiumLiveWindow(catalogRows);
  const limit = MAX_RUNS;
  const used = live_window ? await freemiumSuccessfulRunCount(ip) : 0;
  const remaining = live_window && limit > 0 ? Math.max(0, limit - used) : limit > 0 ? limit : 0;
  return {
    enabled,
    live_window,
    limit,
    used,
    remaining,
    ist_date,
  };
}
