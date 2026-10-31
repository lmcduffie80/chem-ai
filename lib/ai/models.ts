// Plain "provider/model" strings route through Vercel AI Gateway (OIDC auth on Vercel).
export const TEXT_MODEL = process.env.AI_TEXT_MODEL ?? "anthropic/claude-sonnet-5.5";
export const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
