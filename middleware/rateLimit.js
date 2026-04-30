import { redis, TTL } from "../lib/redis.js";

/**
 * Distributed per-IP rate limit when Upstash is configured; otherwise use `memoryFn`.
 * @param {string} ip
 * @param {"messages" | "judge"} kind
 * @param {() => { ok: boolean }} memoryFn
 * @returns {Promise<{ ok: boolean, retryAfter?: number }>}
 */
export async function rateLimitCheck(ip, kind, memoryFn) {
  const RL_MESSAGES_PER_MIN = Math.max(0, Number(process.env.RL_MESSAGES_PER_MIN) || 30);
  const RL_JUDGE_PER_MIN = Math.max(0, Number(process.env.RL_JUDGE_PER_MIN) || 15);
  const limit = kind === "messages" ? RL_MESSAGES_PER_MIN : RL_JUDGE_PER_MIN;
  if (!limit) return { ok: true };

  const r = redis;
  if (!r) return memoryFn();

  const windowKey = Math.floor(Date.now() / 60_000);
  const key = `rl:${kind}:${ip}:${windowKey}`;
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, TTL.RATE_LIMIT);
  if (count > limit) return { ok: false, retryAfter: 60 };
  return { ok: true };
}
