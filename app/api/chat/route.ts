import { createAgentUIStreamResponse } from "ai";
import { chemChatAgent } from "@/lib/ai/chat-agent";
import { billingOwner, getViewer } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { limitAiRequests } from "@/lib/ratelimit";
import { recordUsage } from "@/lib/usage";

export const maxDuration = 60;

/** Bounds request size and model context; the client resends the whole conversation each turn. */
const MAX_MESSAGES = 30;

export async function POST(request: Request) {
  const viewer = await getViewer();
  const owner = billingOwner(viewer);
  if (!owner) return Response.json({ error: "Sign in to use chat." }, { status: 401 });
  if (!can(viewer.plan, "aiSearch")) return Response.json({ error: "Chat is a Pro feature." }, { status: 403 });

  const limit = await limitAiRequests(owner.ownerId);
  if (!limit.success) return Response.json({ error: "Too many AI requests. Try again in a minute." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return Response.json({ error: "No messages." }, { status: 400 });
  }

  await recordUsage({ ...owner, kind: "ai_search", userId: viewer.userId, path: "/search?mode=chat" });

  return createAgentUIStreamResponse({
    agent: chemChatAgent,
    uiMessages: body.messages.slice(-MAX_MESSAGES),
    abortSignal: request.signal,
  });
}
