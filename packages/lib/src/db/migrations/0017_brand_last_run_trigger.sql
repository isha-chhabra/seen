ALTER TABLE "brands" ADD COLUMN "last_run_triggered_by" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "last_run_triggered_at" timestamp with time zone;
