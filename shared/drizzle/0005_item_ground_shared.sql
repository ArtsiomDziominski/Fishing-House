ALTER TABLE "items" ADD COLUMN "lit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "items_ground_idx" ON "items" USING btree ("ground") WHERE "items"."ground";--> statement-breakpoint
-- Лампа, поставленная на землю раньше, горела, если её хозяин её не гасил (players.world.lamp) — теперь это помнит сама вещь.
UPDATE "items" SET "lit" = true FROM "players" WHERE "items"."player_id" = "players"."id" AND "items"."ground" AND "items"."kind" = 'lamp' AND ("players"."world"->>'lamp')::boolean IS TRUE;