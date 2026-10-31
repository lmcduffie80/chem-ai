ALTER TYPE "public"."ingest_source" ADD VALUE 'chemexpo';--> statement-breakpoint
ALTER TYPE "public"."regulatory_list_code" ADD VALUE 'PEST_INERT';--> statement-breakpoint
CREATE TABLE "chemical_product_categories" (
	"chemical_id" integer NOT NULL,
	"source" text NOT NULL,
	"category" text NOT NULL,
	"product_count" integer NOT NULL,
	CONSTRAINT "chemical_product_categories_chemical_id_source_category_pk" PRIMARY KEY("chemical_id","source","category")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "document_date" date;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "kind" text DEFAULT 'manufacturer' NOT NULL;--> statement-breakpoint
ALTER TABLE "chemical_product_categories" ADD CONSTRAINT "chemical_product_categories_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE cascade ON UPDATE no action;