-- Новая банка червей — пустая: червей сначала копают лопатой (WORMS). Банки, что уже есть, остаются как были.
ALTER TABLE "items" ALTER COLUMN "worms" SET DEFAULT 0;