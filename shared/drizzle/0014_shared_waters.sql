-- Остров теперь общий на всех (общие воды — комната SEA_ROOM): что лежало на острове у каждого причала ('isle:<хозяин>'),
-- переезжает на общий остров (ISLE_PLACE = 'isle'), там, где лежало.
UPDATE "items" SET "place" = 'isle' WHERE "ground" AND "place" LIKE 'isle:%';
