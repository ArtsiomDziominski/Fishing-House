ALTER TABLE "items" ADD COLUMN "worms" smallint DEFAULT 30 NOT NULL;--> statement-breakpoint
-- Банки червей у всех, кто уже играл, стали полными (WORMS.MAX — по умолчанию). Лопаты: каждому, кто уже получил стартовый
-- набор (players.kit), — простая лопата (WORMS: копает по одному червю) в рюкзак. Клетку 0, 0 при входе игровой сервер
-- проверит сам (ITEMS.settle): занята — переложит лопату на свободное место.
INSERT INTO "items" ("player_id", "kind", "x", "y", "rot", "held", "left_hand", "ground")
SELECT p."id", 'shovel-old', 0, 0, false, false, false, false FROM "players" p
WHERE p."kit" AND NOT EXISTS (SELECT 1 FROM "items" i WHERE i."player_id" = p."id" AND i."kind" LIKE 'shovel-%');
