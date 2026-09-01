CREATE TABLE "brand_article_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"direction" text,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"pages_per_search" integer NOT NULL,
	"fresh_only" boolean DEFAULT true NOT NULL,
	"queries" json,
	"payload" json NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_article_searches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_article_searches" ADD CONSTRAINT "brand_article_searches_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_article_searches_brand_id_created_at_idx" ON "brand_article_searches" USING btree ("brand_id","created_at");
