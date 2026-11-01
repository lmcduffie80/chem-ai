import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

if (!redis && process.env.VERCEL_ENV === "production") {
  console.warn("Upstash Redis is not configured; rate limiting is disabled.");
}

const limiters = new Map<string, Ratelimit>();

function limiter(name: string, requests: number, window: `${number} ${"s" | "m" | "h"}`) {
  const key = `${name}:${requests}:${window}`;
  let rl = limiters.get(key);
  if (!rl && redis) {
    rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(requests, window), prefix: `allochemix:${name}`, analytics: true });
    limiters.set(key, rl);
  }
  return rl;
}

export type LimitResult = { success: boolean; limit: number; remaining: number; reset: number };

async function check(name: string, id: string, requests: number, window: `${number} ${"s" | "m" | "h"}`): Promise<LimitResult> {
  const rl = limiter(name, requests, window);
  if (!rl) return { success: true, limit: requests, remaining: requests, reset: 0 };
  const { success, limit, remaining, reset } = await rl.limit(id);
  return { success, limit, remaining, reset };
}

export function limitAiRequests(ownerId: string) {
  return check("ai", ownerId, 10, "1 m");
}

export function limitApiKey(apiKeyId: string, perMinute: number) {
  return check("api", apiKeyId, perMinute, "1 m");
}

export function limitAnonymous(ip: string) {
  return check("anon", ip, 60, "1 m");
}
