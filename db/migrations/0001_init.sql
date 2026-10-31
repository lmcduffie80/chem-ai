CREATE TYPE "public"."alternative_method" AS ENUM('scil', 'similarity', 'ai');--> statement-breakpoint
CREATE TYPE "public"."change_type" AS ENUM('added', 'removed', 'updated');--> statement-breakpoint
CREATE TYPE "public"."ingest_source" AS ENUM('tsca', 'comptox', 'pubchem_ghs', 'reglists', 'scil', 'sds_feed', 'embeddings', 'alerts');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('open', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."owner_type" AS ENUM('user', 'org');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'pro', 'team', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."regulatory_list_code" AS ENUM('SARA313', 'CERCLA', 'HAP', 'PROP65', 'RCRA');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('api_request', 'sds_view', 'ai_alternatives', 'ai_search', 'export');--> statement-breakpoint
CREATE TABLE "alternatives" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alternatives_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chemical_id" integer NOT NULL,
	"alt_chemical_id" integer NOT NULL,
	"function_class" text,
	"score" real NOT NULL,
	"hazard_delta" real,
	"rationale" text,
	"method" "alternative_method" NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hashed_key" text NOT NULL,
	"created_by" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chemicals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chemicals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cas_rn" text NOT NULL,
	"dtxsid" text,
	"pubchem_cid" integer,
	"preferred_name" text NOT NULL,
	"molecular_formula" text,
	"mol_weight" double precision,
	"smiles" text,
	"inchikey" text,
	"tsca_status" text,
	"tsca_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_uvcb" boolean DEFAULT false NOT NULL,
	"function_classes" text[] DEFAULT '{}'::text[] NOT NULL,
	"safer_choice_status" text,
	"hazard_score" real,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(cas_rn, '')), 'A') || setweight(to_tsvector('english', coalesce(preferred_name, '')), 'A')) STORED,
	"embedding" vector(1536),
	"enriched_at" timestamp with time zone,
	"ghs_checked_at" timestamp with time zone,
	"embedded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_quality_issues" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_quality_issues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"issue" text NOT NULL,
	"details" text,
	"severity" text DEFAULT 'warning' NOT NULL,
	"status" "issue_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hazards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hazards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chemical_id" integer NOT NULL,
	"source" text NOT NULL,
	"signal_word" text,
	"classifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"h_statements" text[] DEFAULT '{}'::text[] NOT NULL,
	"p_statements" text[] DEFAULT '{}'::text[] NOT NULL,
	"pictograms" text[] DEFAULT '{}'::text[] NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "ingest_source" NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"workflow_run_id" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_components" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_components_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" uuid NOT NULL,
	"chemical_id" integer,
	"cas_rn" text,
	"component_name" text NOT NULL,
	"min_pct" real,
	"max_pct" real
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"grade" text,
	"purity" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulatory_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "regulatory_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chemical_id" integer NOT NULL,
	"list_code" "regulatory_list_code" NOT NULL,
	"change_type" "change_type" NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "regulatory_listings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "regulatory_listings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chemical_id" integer NOT NULL,
	"list_code" "regulatory_list_code" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_date" date,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text,
	"query" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sds_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"org_id" text,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"revision_date" date,
	"language" text DEFAULT 'en' NOT NULL,
	"region" text DEFAULT 'US' NOT NULL,
	"blob_pathname" text,
	"content_hash" text,
	"sections" jsonb,
	"summary" text,
	"parsed_at" timestamp with time zone,
	"parse_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"key" text PRIMARY KEY NOT NULL,
	"blob_pathname" text NOT NULL,
	"filename" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" "owner_type" NOT NULL,
	"owner_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"plan" "plan_tier" NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"website" text,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certifications" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synonyms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "synonyms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chemical_id" integer NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"owner_type" "owner_type" NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text,
	"api_key_id" uuid,
	"kind" "usage_kind" NOT NULL,
	"path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"name" text,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "owner_type" NOT NULL,
	"owner_id" text NOT NULL,
	"chemical_id" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"chemical_id" integer,
	"product_id" uuid,
	"sds_document_id" uuid,
	"label" text NOT NULL,
	"location" text,
	"quantity" real,
	"unit" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alternatives" ADD CONSTRAINT "alternatives_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alternatives" ADD CONSTRAINT "alternatives_alt_chemical_id_chemicals_id_fk" FOREIGN KEY ("alt_chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazards" ADD CONSTRAINT "hazards_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_changes" ADD CONSTRAINT "regulatory_changes_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_listings" ADD CONSTRAINT "regulatory_listings_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sds_documents" ADD CONSTRAINT "sds_documents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synonyms" ADD CONSTRAINT "synonyms_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_inventory" ADD CONSTRAINT "workspace_inventory_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_inventory" ADD CONSTRAINT "workspace_inventory_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_inventory" ADD CONSTRAINT "workspace_inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_inventory" ADD CONSTRAINT "workspace_inventory_sds_document_id_sds_documents_id_fk" FOREIGN KEY ("sds_document_id") REFERENCES "public"."sds_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alternatives_pair_idx" ON "alternatives" USING btree ("chemical_id","alt_chemical_id");--> statement-breakpoint
CREATE INDEX "alternatives_status_idx" ON "alternatives" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hashed_key_idx" ON "api_keys" USING btree ("hashed_key");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chemicals_cas_rn_idx" ON "chemicals" USING btree ("cas_rn");--> statement-breakpoint
CREATE INDEX "chemicals_dtxsid_idx" ON "chemicals" USING btree ("dtxsid");--> statement-breakpoint
CREATE INDEX "chemicals_search_vector_idx" ON "chemicals" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "chemicals_name_trgm_idx" ON "chemicals" USING gin ("preferred_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "chemicals_function_classes_idx" ON "chemicals" USING gin ("function_classes");--> statement-breakpoint
CREATE INDEX "chemicals_embedding_idx" ON "chemicals" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "data_quality_entity_issue_idx" ON "data_quality_issues" USING btree ("entity_type","entity_id","issue");--> statement-breakpoint
CREATE INDEX "data_quality_status_idx" ON "data_quality_issues" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "hazards_chemical_source_idx" ON "hazards" USING btree ("chemical_id","source");--> statement-breakpoint
CREATE INDEX "ingest_runs_source_started_idx" ON "ingest_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "product_components_product_idx" ON "product_components" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_components_chemical_idx" ON "product_components" USING btree ("chemical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_source_external_idx" ON "products" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "products_supplier_idx" ON "products" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "regulatory_changes_chemical_idx" ON "regulatory_changes" USING btree ("chemical_id");--> statement-breakpoint
CREATE INDEX "regulatory_changes_unnotified_idx" ON "regulatory_changes" USING btree ("notified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_listings_chemical_list_idx" ON "regulatory_listings" USING btree ("chemical_id","list_code");--> statement-breakpoint
CREATE INDEX "regulatory_listings_list_idx" ON "regulatory_listings" USING btree ("list_code");--> statement-breakpoint
CREATE INDEX "saved_searches_user_idx" ON "saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sds_documents_source_external_idx" ON "sds_documents" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "sds_documents_product_idx" ON "sds_documents" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sds_documents_org_idx" ON "sds_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "subscriptions_owner_idx" ON "subscriptions" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_source_external_idx" ON "suppliers" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "suppliers_name_trgm_idx" ON "suppliers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "synonyms_chemical_name_idx" ON "synonyms" USING btree ("chemical_id","name");--> statement-breakpoint
CREATE INDEX "synonyms_name_trgm_idx" ON "synonyms" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "usage_events_owner_kind_time_idx" ON "usage_events" USING btree ("owner_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_owner_chemical_idx" ON "watchlists" USING btree ("owner_type","owner_id","chemical_id");--> statement-breakpoint
CREATE INDEX "watchlists_chemical_idx" ON "watchlists" USING btree ("chemical_id");--> statement-breakpoint
CREATE INDEX "workspace_inventory_org_idx" ON "workspace_inventory" USING btree ("org_id");