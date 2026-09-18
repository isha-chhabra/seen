ALTER TABLE "brand_article_searches" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_article_searches" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "brand_article_searches" ADD COLUMN "progress_pct" integer;--> statement-breakpoint
ALTER TABLE "brand_article_searches" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_article_searches" ADD COLUMN "error" text;
