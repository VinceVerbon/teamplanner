ALTER TABLE "clubs" ADD COLUMN "password_custom_min_length" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "password_custom_require_lowercase" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "password_custom_require_uppercase" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "password_custom_require_digit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "password_custom_require_symbol" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "nav_placement" text DEFAULT 'left' NOT NULL;