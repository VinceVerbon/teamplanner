ALTER TABLE "clubs" ADD COLUMN "password_policy" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "must_set_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_bootstrap_admin" boolean DEFAULT false NOT NULL;