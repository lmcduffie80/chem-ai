// Plain "provider/model" strings route through Vercel AI Gateway (OIDC auth on Vercel).
export const TEXT_MODEL = process.env.AI_TEXT_MODEL ?? "openai/gpt-6.1-terra";
// Search query parsing is on the request path, so it uses a smaller, faster model.
export const SEARCH_MODEL = process.env.AI_SEARCH_MODEL ?? "openai/gpt-6-luna";
export const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
