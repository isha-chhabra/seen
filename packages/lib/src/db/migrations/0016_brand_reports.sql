CREATE TYPE "public"."brand_report_status" AS ENUM('processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "brand_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"compare_start" text,
	"compare_end" text,
	"status" "brand_report_status" DEFAULT 'processing' NOT NULL,
	"payload" json,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "brand_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_reports" ADD CONSTRAINT "brand_reports_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_reports_brand_id_created_at_idx" ON "brand_reports" USING btree ("brand_id","created_at");--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "last_report_generated_at" timestamp with time zone;
