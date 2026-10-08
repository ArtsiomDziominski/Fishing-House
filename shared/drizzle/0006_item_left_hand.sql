ALTER TABLE "items" ADD COLUMN "left_hand" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Раньше руки шли по порядку номеров, и вторая (она же носила ведро) — теперь левая.
UPDATE "items" SET "left_hand" = true WHERE "held" AND "id" IN (SELECT max("id") FROM "items" WHERE "held" GROUP BY "player_id" HAVING count(*) = 2);