import "server-only";
import { after } from "next/server";
import { findActiveKey, readApiKey, touchApiKey } from "@/lib/api-keys";
import { planFor } from "@/lib/auth";
import { PLANS } from "@/lib/entitlements";
import { limitApiKey } from "@/lib/ratelimit";
import { countUsageThisMonth, recordUsage } from "@/lib/usage";

export type ApiContext = { orgId: string; apiKeyId: string };

export function apiError(status: number, code: string, message: string, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

/**
 * Authenticates an API key, enforces the per-minute rate limit and monthly quota for the key's
 * organization plan, and meters the request.
 */
export function withApiKey<Ctx>(handler: (request: Request, api: ApiContext, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    const key = readApiKey(request);
    if (!key) return apiError(401, "unauthorized", "Provide an API key via `Authorization: Bearer cs_...`.");
    const apiKey = await findActiveKey(key);
    if (!apiKey) return apiError(401, "unauthorized", "API key is invalid or revoked.");

    const plan = PLANS[await planFor("org", apiKey.orgId)];
    if (!plan.api) return apiError(403, "plan_required", "API access requires an Enterprise plan.");

    const rl = await limitApiKey(apiKey.id, plan.apiRequestsPerMinute);
    const rateHeaders = {
      "x-ratelimit-limit": String(rl.limit),
      "x-ratelimit-remaining": String(rl.remaining),
      ...(rl.reset ? { "x-ratelimit-reset": String(Math.ceil(rl.reset / 1000)) } : {}),
    };
    if (!rl.success) return apiError(429, "rate_limited", "Too many requests; slow down.", rateHeaders);

    const used = await countUsageThisMonth(apiKey.orgId, "api_request");
    if (used >= plan.apiRequestsPerMonth) {
      return apiError(429, "quota_exceeded", `Monthly quota of ${plan.apiRequestsPerMonth} requests reached.`, rateHeaders);
    }

    const path = new URL(request.url).pathname;
    after(() =>
      Promise.all([
        recordUsage({ ownerType: "org", ownerId: apiKey.orgId, kind: "api_request", apiKeyId: apiKey.id, path }),
        touchApiKey(apiKey.id),
      ]),
    );

    try {
      const response = await handler(request, { orgId: apiKey.orgId, apiKeyId: apiKey.id }, ctx);
      for (const [k, v] of Object.entries(rateHeaders)) response.headers.set(k, v);
      return response;
    } catch (error) {
      console.error(`API ${path} failed`, error);
      return apiError(500, "internal_error", "Something went wrong.", rateHeaders);
    }
  };
}
