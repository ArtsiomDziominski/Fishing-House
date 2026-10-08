ALTER TABLE "items" ADD COLUMN "fish" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Ведро стало вещью. У каждого, кто уже играл, ведро было в мире (players.world.bucket): в руке или на своём месте у дома —
-- теперь оно в левой руке, если она свободна; поставленное где-то ещё (или когда левая занята) — на земле там же,
-- с хвостами трёх последних рыб. Координаты переносятся на нынешнее место картинки (World.pic = 199, 40), как в cleanWorld.
WITH b AS (
  SELECT p.id,
    (p.world IS NULL OR p.world->'bucket' IS NULL OR coalesce((p.world->'bucket'->>'carried')::boolean, false) OR coalesce((p.world->'bucket'->>'home')::boolean, false))
      AND NOT EXISTS (SELECT 1 FROM "items" i WHERE i."player_id" = p.id AND i."held" AND (i."left_hand" OR i."kind" IN ('net-cast', 'net-seine'))) AS hand,
    coalesce(nullif(round((p.world->'bucket'->>'x')::numeric)::int, 0) + 199 - coalesce(round((p.world->>'picX')::numeric)::int, 0), 356) AS x,
    coalesce(nullif(round((p.world->'bucket'->>'y')::numeric)::int, 0) + 40 - coalesce(round((p.world->>'picY')::numeric)::int, 0), 242) AS y,
    coalesce((SELECT string_agg(t."species", ',' ORDER BY t."caught_at", t."id") FROM (SELECT c."species", c."caught_at", c."id" FROM "catches" c WHERE c."player_id" = p.id ORDER BY c."caught_at" DESC, c."id" DESC LIMIT 3) t), '') AS fish
  FROM "players" p WHERE p."kit"
)
INSERT INTO "items" ("player_id", "kind", "x", "y", "rot", "held", "left_hand", "ground", "fish")
SELECT id, 'bucket', CASE WHEN hand THEN 0 ELSE x END, CASE WHEN hand THEN 0 ELSE y END, false, hand, hand, NOT hand, CASE WHEN hand THEN '' ELSE fish END FROM b;
