ALTER TABLE "parent_links" ADD COLUMN "requested_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "parent_links" ADD COLUMN "token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "self_manage_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "parent_manage_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_token_unique" UNIQUE("token");