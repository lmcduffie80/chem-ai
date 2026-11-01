# Allochemix

Chemical reference platform: every CAS number on EPA's TSCA Inventory, enriched with EPA CompTox and PubChem hazard data, regulatory list membership, SDS documents and supplier products from a licensed feed, and AI-ranked safer alternatives. Multi-tenant (Clerk Organizations) with Stripe subscriptions, a public REST API and an admin console.

## Before launch: licensing checklist

These are business/legal confirmations, not code. Do not open the product to paying customers until each is settled in writing.

1. **CAS Registry Numbers (American Chemical Society).** CAS RNs and CAS index names are ACS property. Allochemix only displays CAS numbers that EPA publishes in the public TSCA Inventory, and the site carries the trademark/non-affiliation notice on `/data-sources`. However, selling access to a CAS-keyed database and offering bulk export (`/api/workspace/export`, the Enterprise API) may require a license. Contact CAS (cas.org, "CAS Registry licensing / data licensing") describing: the number of records (~86k TSCA substances), that all CAS RNs come from EPA public data, the paid tiers, API access and CSV export. Get either a license or a written determination that none is needed.
2. **SDS/supplier vendor contract (3E/Verisk, UL WERCS, Chemwatch, Sphera, …).** The contract must explicitly allow:
   - redistribution of SDS PDFs and parsed SDS content to *multiple unrelated customer organizations* (multi-tenant SaaS), not only internal use;
   - storing copies in our own storage (Vercel Blob) and serving them via our API;
   - deriving AI summaries/alternatives from SDS content;
   - attribution requirements, update/retention obligations (e.g. purge on withdrawal), and territory limits.
   If redistribution is restricted, keep `SDS_PROVIDER` unset in production and limit SDS features to customer-uploaded documents (Team workspaces), which are scoped per organization.
3. **Regulatory list sources.** Prop 65 (OEHHA) and EPA lists are public, but record the source URL/date in admin → Ingestion uploads for each list you load.
4. **AI-generated content.** Alternatives are labelled "AI-suggested · pending expert review" until approved in admin → Alternatives review. Keep that review step staffed by a qualified chemist/EHS professional.
5. **Terms of Service / Privacy Policy** for the paid tiers (not included in this repo).

Attribution and disclaimers shown to users live in `app/data-sources/page.tsx`.

## Stack

Next.js 16 (App Router, Cache Components) · Neon Postgres + Drizzle (pg_trgm, pgvector) · Clerk (auth + Organizations) · Stripe · Vercel Blob · Upstash Redis · Vercel Workflow + Cron · AI SDK via AI Gateway.

## Local setup

```bash
pnpm install
vercel link --scope lee-mcduffies-projects
vercel env pull .env.local --yes   # Neon, Blob, Clerk, Upstash once integrations are installed
pnpm db:migrate
pnpm db:seed:tsca                  # loads the EPA TSCA Inventory (~86k rows)
pnpm dev
```

See `.env.example` for every variable. Without Clerk keys from the Vercel integration you can run `npx clerk@latest init --accountless` for a keyless dev instance.

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm db:generate` / `db:migrate` | Drizzle migrations (`db/migrations`) |
| `pnpm db:seed:tsca` | Load TSCA Inventory |
| `pnpm enrich:cas 67-64-1 …` | PubChem synonyms + GHS hazards for specific CAS numbers |
| `pnpm sync:sds` | Pull products + SDS from the configured `SDS_PROVIDER` |
| `pnpm typecheck` | Route type generation + `tsc` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm check:alternates <productId>` | Check the alternates SQL against the reference scorer |
| `pnpm db:size` | Database size and largest tables |

### Scheduled ingestion

`vercel.json` schedules `/api/cron/{sds,tsca,reglists,scil,comptox,ghs,embeddings,alerts,chemexpo}`. Each starts a durable workflow (`workflows/ingest.ts`) and writes an `ingest_runs` row. Cron requests must carry `Authorization: Bearer $CRON_SECRET`. Platform admins can also trigger jobs and upload source-file overrides at `/admin/ingestion`.

Data sources that need configuration:

- **CompTox:** `EPA_CCTE_API_KEY` (free, request from EPA CCTE).
- **Regulatory lists:** set `REGLIST_*_URL` to CSV exports, or upload files in the admin console.
- **SCIL:** defaults to EPA's Safer Ingredients page; no configuration needed.
- **Products (EPA ChemExpo/CPDat):** downloads EPA's public composition file weekly (about 1 GB unzipped, 400k documents). Repeat filings of the same product (same maker and name) are merged into the newest one, leaving roughly 325k products with full ingredient lists. These power the product lists on chemical pages and the alternates on product pages. EPA's server is slow; for the first load, download the zip yourself and run `pnpm load:chemexpo path/to/file.zip`, then `pnpm db:size` to check database size (about 640 MB after a full load). The pesticide inert list (`PEST_INERT`) comes from ChemExpo's list-presence file; load it with `pnpm load:reglist PEST_INERT`.
- **Where to buy:** PubChem vendor listings, fetched on demand and cached for a week. No configuration needed.
- **SDS feed:** `SDS_PROVIDER=generic-rest` with `SDS_PROVIDER_BASE_URL`/`SDS_PROVIDER_API_KEY`. The adapter contract is documented in `lib/sds/providers/generic-rest.ts`; write a thin shim for your vendor or add a new provider in `lib/sds/`. `SDS_PROVIDER=fixture` gives demo data and is refused in production.
- **AI:** AI Gateway via OIDC. Alternatives and SDS parsing use `AI_TEXT_MODEL`; natural-language search uses the faster `AI_SEARCH_MODEL`; embeddings (`AI_EMBEDDING_MODEL`) are optional but improve candidate recall. Free-tier gateway accounts cannot use Anthropic models or OpenAI embeddings.

## Production configuration

1. Accept terms for the Clerk and Upstash integrations in the Vercel dashboard, then install them for the project.
2. Clerk: enable Organizations, add an `org:viewer` role, and add a webhook to `/api/webhooks/clerk` (user, organization, organizationMembership events) → `CLERK_WEBHOOK_SIGNING_SECRET`.
3. Stripe: create Pro/Team/Enterprise recurring prices → `STRIPE_PRICE_*`; add a webhook to `/api/webhooks/stripe` (`checkout.session.completed`, `customer.subscription.*`) → `STRIPE_WEBHOOK_SECRET`; enable the Customer Portal.
4. Set `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, `PLATFORM_ADMIN_USER_IDS` (comma-separated Clerk user IDs), `RESEND_API_KEY`, `ALERTS_FROM_EMAIL`.

## Project map

- `app/chemicals/[cas]`, `app/search`, `app/products`, `app/suppliers`, `app/sds` — public and gated reference pages
- `app/workspace/*` — Team workspaces (inventory, SDS library, watchlist, members, API keys)
- `app/admin/*` — ingestion, data quality, alternatives review, tenants, usage
- `app/api/v1/*` — public API (OpenAPI at `/api/v1/openapi.json`, docs at `/docs/api`)
- `lib/ingest/*`, `workflows/ingest.ts` — data pipelines
- `lib/ai/alternatives.ts` — SCIL + similarity + hazard scoring + LLM re-ranking
- `lib/entitlements.ts` — plan limits; `lib/billing/stripe.ts` — subscription sync
