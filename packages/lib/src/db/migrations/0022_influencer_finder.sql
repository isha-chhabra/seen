CREATE TABLE "brand_influencer_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"direction" text,
	"brief" json NOT NULL,
	"payload" json NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"stage" text,
	"progress_pct" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "influencer_profiles" (
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"data" json NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "influencer_profiles_platform_handle_pk" PRIMARY KEY("platform","handle")
);
--> statement-breakpoint
ALTER TABLE "brand_influencer_searches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "influencer_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_influencer_searches" ADD CONSTRAINT "brand_influencer_searches_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_influencer_searches_brand_id_created_at_idx" ON "brand_influencer_searches" USING btree ("brand_id","created_at");
