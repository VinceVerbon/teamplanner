CREATE TABLE "speeldag_kalender_cells" (
	"id" text PRIMARY KEY NOT NULL,
	"kalender_id" text NOT NULL,
	"day_id" text NOT NULL,
	"column_id" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speeldag_kalender_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"season" text NOT NULL,
	"region" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speeldag_kalender_columns" (
	"id" text PRIMARY KEY NOT NULL,
	"kalender_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speeldag_kalender_days" (
	"id" text PRIMARY KEY NOT NULL,
	"kalender_id" text NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"date_start" date NOT NULL,
	"date_end" date,
	"remark" text
);
--> statement-breakpoint
CREATE TABLE "speeldag_kalenders" (
	"id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"region" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"source_url" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "has_national_teams" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "kalender_column_id" text;--> statement-breakpoint
ALTER TABLE "speeldag_kalender_cells" ADD CONSTRAINT "speeldag_kalender_cells_kalender_id_speeldag_kalenders_id_fk" FOREIGN KEY ("kalender_id") REFERENCES "public"."speeldag_kalenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speeldag_kalender_cells" ADD CONSTRAINT "speeldag_kalender_cells_day_id_speeldag_kalender_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."speeldag_kalender_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speeldag_kalender_cells" ADD CONSTRAINT "speeldag_kalender_cells_column_id_speeldag_kalender_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."speeldag_kalender_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speeldag_kalender_columns" ADD CONSTRAINT "speeldag_kalender_columns_kalender_id_speeldag_kalenders_id_fk" FOREIGN KEY ("kalender_id") REFERENCES "public"."speeldag_kalenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speeldag_kalender_days" ADD CONSTRAINT "speeldag_kalender_days_kalender_id_speeldag_kalenders_id_fk" FOREIGN KEY ("kalender_id") REFERENCES "public"."speeldag_kalenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "speeldag_cells_day_column_uq" ON "speeldag_kalender_cells" USING btree ("day_id","column_id");--> statement-breakpoint
CREATE UNIQUE INDEX "speeldag_kalenders_season_region_status_uq" ON "speeldag_kalenders" USING btree ("season","region","status");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_kalender_column_id_speeldag_kalender_columns_id_fk" FOREIGN KEY ("kalender_column_id") REFERENCES "public"."speeldag_kalender_columns"("id") ON DELETE set null ON UPDATE no action;