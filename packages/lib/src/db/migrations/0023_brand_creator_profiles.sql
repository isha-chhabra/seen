CREATE TABLE "brand_creator_profiles" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"profile" json NOT NULL,
	"source" text DEFAULT 'website' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_creator_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_creator_profiles" ADD CONSTRAINT "brand_creator_profiles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
