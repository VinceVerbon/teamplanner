ALTER TABLE "training_sessions" ALTER COLUMN "location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "type" text DEFAULT 'training' NOT NULL;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "location_text" text;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "opponent" text;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "home_away" text;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD COLUMN "external_uid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "training_sessions_team_external_uid_uq" ON "training_sessions" USING btree ("team_id","external_uid");