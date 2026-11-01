CREATE TABLE "chemical_doc_freq" (
	"chemical_id" integer PRIMARY KEY NOT NULL,
	"product_count" integer NOT NULL
);
--> statement-breakpoint
DROP INDEX "product_components_chemical_idx";--> statement-breakpoint
ALTER TABLE "product_components" ALTER COLUMN "component_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_components" ADD COLUMN "weight" real;--> statement-breakpoint
ALTER TABLE "chemical_doc_freq" ADD CONSTRAINT "chemical_doc_freq_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_components_chemical_idx" ON "product_components" USING btree ("chemical_id","product_id");