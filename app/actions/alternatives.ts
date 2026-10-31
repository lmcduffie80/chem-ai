"use server";

import { updateTag } from "next/cache";
import { billingOwner, getViewer } from "@/lib/auth";
import { generateAlternatives } from "@/lib/ai/alternatives";
import { can } from "@/lib/entitlements";
import { limitAiRequests } from "@/lib/ratelimit";
import { recordUsage } from "@/lib/usage";

export async function generateAlternativesAction(chemicalId: number): Promise<{ count?: number; error?: string }> {
  const viewer = await getViewer();
  const owner = billingOwner(viewer);
  if (!owner) return { error: "Sign in to generate alternatives." };
  if (!can(viewer.plan, "aiAlternatives")) return { error: "AI alternatives require a Pro plan or higher." };

  const limit = await limitAiRequests(owner.ownerId);
  if (!limit.success) return { error: "Too many AI requests. Try again in a minute." };

  await recordUsage({ ...owner, kind: "ai_alternatives", userId: viewer.userId, path: `/chemicals/${chemicalId}` });
  try {
    const count = await generateAlternatives(chemicalId);
    updateTag(`alternatives:${chemicalId}`);
    return { count };
  } catch (error) {
    console.error(error);
    return { error: "Could not generate alternatives right now." };
  }
}
