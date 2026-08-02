CREATE TABLE "instance_admins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_admins_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"date_format" text DEFAULT 'DD-MM-YYYY' NOT NULL,
	"time_format" text DEFAULT '24h' NOT NULL,
	"week_numbering" text DEFAULT 'iso' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "main_location_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "is_club_location" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_admins" ADD CONSTRAINT "instance_admins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_main_location_id_locations_id_fk" FOREIGN KEY ("main_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;