CREATE TABLE "knvb_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"region" text NOT NULL,
	"url" text NOT NULL,
	"confirmed_at" timestamp DEFAULT now() NOT NULL
);
