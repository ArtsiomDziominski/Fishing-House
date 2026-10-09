-- Улов теперь лежит в самом ведре (catches.bucket_id): кто унёс ведро, тот унёс и рыбу, а из ведра на земле её достаёт любой.
-- Прежний улов ни в каком ведре не лежал — по просьбе игры его сбрасываем: все вёдра пустые (рекорды в профиле остаются).
-- Земля теперь у каждого места своя (items.place); всё, что уже лежит, — на общем причале.
DROP INDEX "items_ground_idx";--> statement-breakpoint
ALTER TABLE "catches" ADD COLUMN "bucket_id" bigint;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "place" text DEFAULT 'pier' NOT NULL;--> statement-breakpoint
ALTER TABLE "catches" ADD CONSTRAINT "catches_bucket_id_items_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catches_bucket_idx" ON "catches" USING btree ("bucket_id") WHERE NOT "catches"."gone";--> statement-breakpoint
CREATE INDEX "items_ground_idx" ON "items" USING btree ("place") WHERE "items"."ground";--> statement-breakpoint
UPDATE "catches" SET "gone" = true WHERE NOT "gone";--> statement-breakpoint
UPDATE "items" SET "fish" = '' WHERE "kind" = 'bucket';
