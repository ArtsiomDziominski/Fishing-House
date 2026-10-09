-- У каждого игрока свой причал (items.place = 'pier:<id хозяина>'), общего больше нет: что лежало на общем, удаляем
-- (рыба в удалённых вёдрах — ни в каком ведре, catches.bucket_id обнулится сам).
-- Сундук в доме: вещи в нём (items.chest) — в его сетке; вид сундука — players.chest (CHEST_KINDS).
ALTER TABLE "items" ADD COLUMN "chest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "chest" text DEFAULT 'box' NOT NULL;--> statement-breakpoint
DELETE FROM "items" WHERE "ground" AND "place" = 'pier';
