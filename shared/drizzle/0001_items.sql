CREATE TABLE "items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"kind" text NOT NULL,
	"x" smallint NOT NULL,
	"y" smallint NOT NULL,
	"rot" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "kit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_player_idx" ON "items" USING btree ("player_id");