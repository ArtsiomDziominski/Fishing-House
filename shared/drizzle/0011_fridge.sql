-- Холодильник в доме: рыба на полке игрока (FRIDGE в shared/src/indoor.ts) — не в рюкзаке, не в руке и не на земле.
ALTER TABLE "items" ADD COLUMN "fridge" boolean DEFAULT false NOT NULL;