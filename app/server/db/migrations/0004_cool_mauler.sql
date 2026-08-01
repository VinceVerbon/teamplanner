CREATE TABLE "absences" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"team_id" text NOT NULL,
	"session_id" text NOT NULL,
	"player_user_id" text NOT NULL,
	"reported_by_user_id" text,
	"classification" text NOT NULL,
	"source" text DEFAULT 'reported' NOT NULL,
	"reason" text,
	"reported_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_player_user_id_user_id_fk" FOREIGN KEY ("player_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_reported_by_user_id_user_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "absences_session_player_uq" ON "absences" USING btree ("session_id","player_user_id");