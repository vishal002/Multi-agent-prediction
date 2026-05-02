/**
 * Upstash Redis REST client (optional). When env is unset, exports null `redis`.
 */
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

/** @type {InstanceType<typeof Redis> | null} */
export const redis = url && token ? new Redis({ url, token }) : null;

export function redisEnabled() {
  return redis != null;
}

/** TTL seconds — single source of truth for cache keys */
export const TTL = {
  LIVE_SCORE: 30,
  MATCH_CONTEXT: 300,
  WARROOM_RUN: 600,
  SHARE_VERDICT: 86400,
  FIXTURES_LIST: 3600,
  RATE_LIMIT: 60,
  JUDGE_ACCURACY: 3600,
  /** Freemium daily run counter — two IST days of slack */
  FREEMIUM_RUN: 200_000,
};
