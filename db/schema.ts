import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 1536;

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const regulatoryListCode = pgEnum("regulatory_list_code", [
  "SARA313",
  "CERCLA",
  "HAP",
  "PROP65",
  "RCRA",
  "PEST_INERT",
]);

export const alternativeMethod = pgEnum("alternative_method", ["scil", "similarity", "ai"]);
export const reviewStatus = pgEnum("review_status", ["pending", "approved", "rejected"]);
export const planTier = pgEnum("plan_tier", ["free", "pro", "team", "enterprise"]);
export const ownerType = pgEnum("owner_type", ["user", "org"]);
export const ingestSource = pgEnum("ingest_source", [
  "tsca",
  "comptox",
  "pubchem_ghs",
  "reglists",
  "scil",
  "sds_feed",
  "embeddings",
  "alerts",
  "chemexpo",
]);
export const runStatus = pgEnum("run_status", ["running", "succeeded", "failed"]);
export const changeType = pgEnum("change_type", ["added", "removed", "updated"]);
export const issueStatus = pgEnum("issue_status", ["open", "resolved", "ignored"]);
export const usageKind = pgEnum("usage_kind", [
  "api_request",
  "sds_view",
  "ai_alternatives",
  "ai_search",
  "export",
]);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const chemicals = pgTable(
  "chemicals",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    casRn: text("cas_rn").notNull(),
    dtxsid: text("dtxsid"),
    pubchemCid: integer("pubchem_cid"),
    preferredName: text("preferred_name").notNull(),
    molecularFormula: text("molecular_formula"),
    molWeight: doublePrecision("mol_weight"),
    smiles: text("smiles"),
    inchikey: text("inchikey"),
    tscaStatus: text("tsca_status"),
    tscaFlags: text("tsca_flags").array().notNull().default(sql`'{}'::text[]`),
    isUvcb: boolean("is_uvcb").notNull().default(false),
    functionClasses: text("function_classes").array().notNull().default(sql`'{}'::text[]`),
    saferChoiceStatus: text("safer_choice_status"),
    hazardScore: real("hazard_score"),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(cas_rn, '')), 'A') || setweight(to_tsvector('english', coalesce(preferred_name, '')), 'A')`,
    ),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    ghsCheckedAt: timestamp("ghs_checked_at", { withTimezone: true }),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("chemicals_cas_rn_idx").on(t.casRn),
    index("chemicals_dtxsid_idx").on(t.dtxsid),
    index("chemicals_search_vector_idx").using("gin", t.searchVector),
    index("chemicals_name_trgm_idx").using("gin", t.preferredName.op("gin_trgm_ops")),
    index("chemicals_function_classes_idx").using("gin", t.functionClasses),
    index("chemicals_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const synonyms = pgTable(
  "synonyms",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    chemicalId: integer("chemical_id")
      .notNull()
      .references(() => chemicals.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: text("source").notNull(),
  },
  (t) => [
    uniqueIndex("synonyms_chemical_name_idx").on(t.chemicalId, t.name),
    index("synonyms_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
  ],
);

export type GhsClassification = { hazardClass: string; category?: string };

export const hazards = pgTable(
  "hazards",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    chemicalId: integer("chemical_id")
      .notNull()
      .references(() => chemicals.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    signalWord: text("signal_word"),
    classifications: jsonb("classifications").$type<GhsClassification[]>().notNull().default([]),
    hStatements: text("h_statements").array().notNull().default(sql`'{}'::text[]`),
    pStatements: text("p_statements").array().notNull().default(sql`'{}'::text[]`),
    pictograms: text("pictograms").array().notNull().default(sql`'{}'::text[]`),
    score: real("score").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("hazards_chemical_source_idx").on(t.chemicalId, t.source)],
);

export const regulatoryListings = pgTable(
  "regulatory_listings",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    chemicalId: integer("chemical_id")
      .notNull()
      .references(() => chemicals.id, { onDelete: "cascade" }),
    listCode: regulatoryListCode("list_code").notNull(),
    details: jsonb("details").$type<Record<string, string>>().notNull().default({}),
    effectiveDate: date("effective_date"),
    sourceUrl: text("source_url"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("regulatory_listings_chemical_list_idx").on(t.chemicalId, t.listCode),
    index("regulatory_listings_list_idx").on(t.listCode),
  ],
);

export const regulatoryChanges = pgTable(
  "regulatory_changes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    chemicalId: integer("chemical_id")
      .notNull()
      .references(() => chemicals.id, { onDelete: "cascade" }),
    listCode: regulatoryListCode("list_code").notNull(),
    changeType: changeType("change_type").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    index("regulatory_changes_chemical_idx").on(t.chemicalId),
    index("regulatory_changes_unnotified_idx").on(t.notifiedAt),
  ],
);

// ---------------------------------------------------------------------------
// Licensed SDS + supplier data
// ---------------------------------------------------------------------------

export type SupplierContact = { name?: string; email?: string; phone?: string; role?: string };

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    /** "manufacturer" for companies that make or sell the product; "database" for aggregators such as SIRI or EWG. */
    kind: text("kind").notNull().default("manufacturer"),
    country: text("country"),
    website: text("website"),
    contacts: jsonb("contacts").$type<SupplierContact[]>().notNull().default([]),
    certifications: text("certifications").array().notNull().default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("suppliers_source_external_idx").on(t.source, t.externalId),
    index("suppliers_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    sku: text("sku"),
    grade: text("grade"),
    purity: text("purity"),
    description: text("description"),
    /** Product use category, e.g. "Personal care › body hygiene › body wash". */
    category: text("category"),
    documentDate: date("document_date"),
    /** Public page describing where the record came from. */
    sourceUrl: text("source_url"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_source_external_idx").on(t.source, t.externalId),
    index("products_supplier_idx").on(t.supplierId),
    index("products_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
  ],
);

export const productComponents = pgTable(
  "product_components",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    chemicalId: integer("chemical_id").references(() => chemicals.id, { onDelete: "set null" }),
    casRn: text("cas_rn"),
    componentName: text("component_name").notNull(),
    minPct: real("min_pct"),
    maxPct: real("max_pct"),
  },
  (t) => [
    index("product_components_product_idx").on(t.productId),
    index("product_components_chemical_idx").on(t.chemicalId),
  ],
);

/** Full product counts per use category; `products` only holds a recent sample per chemical. */
export const chemicalProductCategories = pgTable(
  "chemical_product_categories",
  {
    chemicalId: integer("chemical_id")
      .notNull()
      .references(() => chemicals.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    category: text("category").notNull(),
    productCount: integer("product_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chemicalId, t.source, t.category] })],
);

export type SdsSection = { number: number; title: string; content: string };

export const sdsDocuments = pgTable(
  "sds_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    orgId: text("org_id"),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    /** Display name for workspace uploads, which have no product row. */
    title: text("title"),
    uploadedBy: text("uploaded_by"),
    revisionDate: date("revision_date"),
    language: text("language").notNull().default("en"),
    region: text("region").notNull().default("US"),
    blobPathname: text("blob_pathname"),
    contentHash: text("content_hash"),
    sections: jsonb("sections").$type<SdsSection[]>(),
    summary: text("summary"),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
    parseError: text("parse_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("sds_documents_source_external_idx").on(t.source, t.externalId),
    index("sds_documents_product_idx").on(t.productId),
    index("sds_documents_org_idx").on(t.orgId),
  ],
);

export const alternatives = pgTable(
  "alternatives",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    chemicalId: integer("chemical_id")
      .notNull()
      .references(() => chemicals.id, { onDelete: "cascade" }),
    altChemicalId: integer("alt_chemical_id")
      .notNull()
      .references(() => chemicals.id, { onDelete: "cascade" }),
    functionClass: text("function_class"),
    score: real("score").notNull(),
    hazardDelta: real("hazard_delta"),
    rationale: text("rationale"),
    method: alternativeMethod("method").notNull(),
    status: reviewStatus("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("alternatives_pair_idx").on(t.chemicalId, t.altChemicalId),
    index("alternatives_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Tenancy, billing, usage
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  stripeCustomerId: text("stripe_customer_id"),
  ...timestamps,
});

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug"),
  stripeCustomerId: text("stripe_customer_id"),
  ...timestamps,
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    ownerType: ownerType("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    plan: planTier("plan").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("subscriptions_owner_idx").on(t.ownerType, t.ownerId)],
);

export const workspaceInventory = pgTable(
  "workspace_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    chemicalId: integer("chemical_id").references(() => chemicals.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    sdsDocumentId: uuid("sds_document_id").references(() => sdsDocuments.id, {
      onDelete: "set null",
    }),
    label: text("label").notNull(),
    location: text("location"),
    quantity: real("quantity"),
    unit: text("unit"),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (t) => [index("workspace_inventory_org_idx").on(t.orgId)],
);

export const savedSearches = pgTable(
  "saved_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    orgId: text("org_id"),
    query: text("query").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("saved_searches_user_idx").on(t.userId)],
);

export const watchlists = pgTable(
  "watchlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: ownerType("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    chemicalId: integer("chemical_id")
      .notNull()
      .references(() => chemicals.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("watchlists_owner_chemical_idx").on(t.ownerType, t.ownerId, t.chemicalId),
    index("watchlists_chemical_idx").on(t.chemicalId),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hashedKey: text("hashed_key").notNull(),
    createdBy: text("created_by").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("api_keys_hashed_key_idx").on(t.hashedKey),
    index("api_keys_org_idx").on(t.orgId),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    ownerType: ownerType("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    userId: text("user_id"),
    apiKeyId: uuid("api_key_id"),
    kind: usageKind("kind").notNull(),
    path: text("path"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("usage_events_owner_kind_time_idx").on(t.ownerId, t.kind, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type IngestStats = {
  processed?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  [key: string]: number | undefined;
};

export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: ingestSource("source").notNull(),
    status: runStatus("status").notNull().default("running"),
    trigger: text("trigger").notNull().default("manual"),
    workflowRunId: text("workflow_run_id"),
    stats: jsonb("stats").$type<IngestStats>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("ingest_runs_source_started_idx").on(t.source, t.startedAt)],
);

export const dataQualityIssues = pgTable(
  "data_quality_issues",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    issue: text("issue").notNull(),
    details: text("details"),
    severity: text("severity").notNull().default("warning"),
    status: issueStatus("status").notNull().default("open"),
    resolvedBy: text("resolved_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("data_quality_entity_issue_idx").on(t.entityType, t.entityId, t.issue),
    index("data_quality_status_idx").on(t.status),
  ],
);

/** Admin-uploaded overrides for file-based sources, keyed like `tsca`, `scil`, `reglist:SARA313`. */
export const sourceFiles = pgTable("source_files", {
  key: text("key").primaryKey(),
  blobPathname: text("blob_pathname").notNull(),
  filename: text("filename"),
  uploadedBy: text("uploaded_by").notNull(),
  ...timestamps,
});

export type Chemical = typeof chemicals.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type SdsDocument = typeof sdsDocuments.$inferSelect;
export type PlanTier = (typeof planTier.enumValues)[number];
export type RegulatoryListCode = (typeof regulatoryListCode.enumValues)[number];
export type IngestSource = (typeof ingestSource.enumValues)[number];
export type UsageKind = (typeof usageKind.enumValues)[number];
