# Fishing House — заметки для работы над проектом

Уютная пиксельная онлайн-игра: общий причал, вход по имени и паролю, прогресс в базе. Цель по нагрузке — до 1000 игроков одновременно.

Здесь — общее: стек, границы, команды и правила. Подробности каждой части лежат рядом с ней и подгружаются, когда в ней идёт работа: `shared/CLAUDE.md` (правила игры и база), `game-server/CLAUDE.md` (комната, сохранение, масштаб), `app/CLAUDE.md` (что и как рисует клиент), `tools/CLAUDE.md` (карта и её сборка).

## Стек (решено, не менять без обсуждения)

| Часть | Что | Где |
|---|---|---|
| Фронт | Nuxt 4 + Vue 3 + TypeScript + Pinia; игра на canvas в `/play` | `app/` |
| API | Nuxt (Nitro): вход, регистрация, профили, билеты в игру; дальше — магазин | `app/server/` |
| Игровой сервер | Colyseus 0.18, несколько процессов + Redis | `game-server/` |
| База | PostgreSQL + Drizzle ORM | схема `shared/src/server/schema.ts`, миграции `shared/drizzle/` |
| Общий код | правила рыбалки, карта, рыбы, протокол, типы | `shared/` |
| Хостинг | VPS + Docker Compose + Caddy | `docker-compose.yml`, `Caddyfile`, `Dockerfile` |

## Как устроено

- **Монорепо на npm workspaces**: `shared`, `app`, `game-server`. `@fh/shared` подключается исходниками TypeScript (без сборки): в Nuxt через `build.transpile`, в игровом сервере — `tsx` в разработке и esbuild-бандл (`game-server/build.mjs`) в продакшене.
- **`@fh/shared`** работает и в браузере, и в Node. **`@fh/shared/server`** — только для серверов (база, билеты, `node:crypto`); в код `app/app/` его не импортировать, кроме `import type`.
- **Вход**: `nuxt-auth-utils`, сессия в зашифрованной cookie: `user = { id, name }`, где `id` — публичный id игрока (10 символов `[a-z0-9]`). Пароли — `hashPassword`/`verifyPassword` (scrypt).
- **В игру**: страница `/play` берёт у сайта билет (`POST /api/game/ticket`, HMAC общим `GAME_SECRET`, живёт минуту) и входит в комнату `pier` на Colyseus. `onAuth` комнаты проверяет билет и кладёт `id` игрока в `client.auth.id` — по нему `UniqueSessionPlugin` выбивает старую вкладку (причина `replaced`).
- **Кто главный**: сервер. Клиент ходит сам и шлёт место раз в 0,1 с; сервер проверяет проходимость и скорость (запас хода) и при несогласии шлёт `self`. Рыбалку целиком ведёт сервер (`createFishing` в `shared/src/fishing.ts`): клюёт, кто клюнул, успел ли подсечь (+`HOOK_GRACE` на задержку сети). Забросить можно только с удочкой в одной руке (`ITEMS.isRod`) и банкой червей в другой (`ITEMS.isBait`; обе берут из рюкзака) и с ведром — на земле у места рыбака (или в руке, но рук на всё не хватит); убрал удочку или червей — рыбалка останавливается. Червь уходит, когда рыба клюнула; пустая банка — не забросить; пополняют её лопатой на траве (`WORMS` в `shared/src/worms.ts`). Клиент лишь показывает фазы (`app/app/game/fishing-view.ts`).
- **Что видят другие** — только состояние комнаты (`game-server/src/state.ts`). Свой улов, вещи и рыбалку игрок получает личными сообщениями (`ServerMessages` в `shared/src/protocol.ts`).
- **Карта** 640×360 арт-пикселей — ровно 16:9, она же кадр игры: экран стоит на месте, камеры и масштаба нет. В её середине — картинка-образец (`World.pic` — где она стоит). Разметка в `tools/world-shapes.mjs` — в координатах картинки, всё в игре и в `world-data.ts` — в координатах карты; числа, снятые с картинки прямо в коде (как `bankY` в движке), сдвигать на `World.pic`.
- **Пока только картинка**: время суток, погода, река, лодки, птицы и звери на рыбалку не влияют. Только рыбу, выложенную на землю, уносит чайка или съедает кот (или она тает за минуту) — это решает сервер (`SCRAPS` в `shared/src/scraps.ts`).
- **Голод**: сытость 100 → 0 за световой день, пополняет рыба из ведра (жареная на костре — сильно). Пустая — герой медленнее, а через 3 минуты засыпает на 3 минуты (часть рыбы из ведра пропадает) и просыпается у дома сытым. Ведёт сервер, правила — `shared/src/hunger.ts`.
- **Дом**: в него входят у двери (H или клик), внутри — одна общая комната со своим кадром и проходимостью (`Indoor` в `shared/src/indoor.ts`, `WorldState.inside`); видно там только тех, кто тоже в доме. В креслах у камина жарят рыбу, как у костра, — его дождь не гасит; в кровати спят (сытость тает медленнее); в холодильнике у каждого своя полка для рыбы (`items.fridge`). Земля, рыбалка и копка — снаружи.
- **Масштаб**: в комнате до `ROOM_SIZE` = 50 игроков, дальше матчмейкер открывает новую копию причала; процессы игрового сервера связаны через Redis.

## Где что лежит

| Тема | Правила (`shared/src/`) | Сервер (`game-server/src/`) | Клиент (`app/app/`) |
|---|---|---|---|
| Карта, проходимость | `world.ts`, `world-data.ts` (собирает `tools/`) | `PierRoom.move` | `game/engine.ts` |
| Рыбалка, рыбы | `fishing.ts`, `fish.ts` | `PierRoom.onFishing` | `game/fishing-view.ts` |
| Ведро (вещь), улов, расстояния | `rules.ts` (`bucketNearSeat`), `ITEMS.isBucket`, `Bag` в `protocol.ts` | `bucketFor`, `sit`, `onFishing` | `drawBucket` в движке, `components/GameCatch.vue` |
| Дом снаружи | `house.ts` | — | `game/house.ts` |
| Дом внутри: вход, кресла, кровать, холодильник | `indoor.ts` (`INDOOR`, `Indoor`, `FRIDGE`), `nearDoor`, `WorldState.inside`/`bed`, `server/items.ts` (`loadFridge`, `fridge*`) | `enter`, `exit`, `rest`/`cook` в кресле, `toBed`, `fridgePut`/`fridgeTake`/`fridgeStock` | `game/interior.ts`, `doorAction`, `drawRoom`, `drawDoorScreen`, `restDown`, `bedDown` в движке, `components/GameFridge.vue` |
| Костёр (гаснет в дождь) | `campfire.ts` (`FIRE.douse`) | `rest`, `kindle`, `watchRain` | `game/campfire.ts`, `fireLit`/`kindle` в движке |
| Черви, лопаты, копка | `worms.ts` (`WORMS`), `dig-data.ts` (собирает `tools/build-dig.mjs`) | `dig`, `dug`, `useWorm`, `holes` | `digAction`, `drawHoles` в движке, `shovelColors` в `held-art.ts`, подписи банок в `GameBackpack.vue` |
| Голод, еда, сон | `hunger.ts`, `ITEMS.isFish`/`meal`, `homePoint` | `hunger`, `fishTake`, `eat`, `cook`, `faint`, `wake` | `components/GameHunger.vue`, `GameSleep.vue`, `eatAction` в движке |
| Рюкзак | `packs.ts` | `packOn`, `packOff`, `packKind` | `components/GamePack.vue` |
| Вещи и руки | `items.ts` | `item*` в `PierRoom.ts` | `components/GameBackpack.vue`, `game/backpack-view.ts`, `items-art.ts`, `held-art.ts` |
| Вещи на земле (общие) | `GroundItem`, `ITEMS.dropSpot`, `nearest`, `server/items.ts` (`loadGround`, `claimItem`) | `itemDrop`, `itemPut`, `itemPick`, `PierRoom.ground` | `groundItems` в движке, `groundSprite` в `held-art.ts` |
| Рыба на земле: чайка, кот | `scraps.ts` (`SCRAPS`), `scrapItem` | `doom`, `ending`, `scrap` | `trackScraps` в движке, `thief` в `gull.ts`, `Errand` в `pets.ts` |
| Лампа и свет ночью | `ITEMS.lampNear`, `lampOut` | `lamp` | `game/light.ts`, `drawNight` в движке |
| Время суток | `daytime.ts` | `sky.ts` | `game/night-view.ts` |
| Погода | `weather.ts` | `sky.ts` | `game/weather-view.ts`, `sound.ts` |
| Вход, профили, билеты | `account.ts`, `server/players.ts`, `server/ticket.ts` | `onAuth` | `server/api/`, `pages/` |

## Команды

```bash
npm install                 # все пакеты сразу
cp .env.example .env        # и поменять секреты
npm run db:up               # Postgres и Redis для разработки (docker-compose.dev.yml)
npm run db:migrate          # применить миграции
npm run dev                 # сайт :3000 и игровой сервер :2567 вместе
npm test                    # тесты общего кода (node --test)
npm run typecheck           # типы во всех пакетах
npm run check               # тесты и типы разом
npm run smoke:own -w game-server  # бот проходит игру через свой игровой сервер (нужна только база)
npm run check:all           # тесты, типы и бот — то же гоняет CI (.github/workflows/check.yml)
npm run smoke -w game-server  # тот же бот, но через уже запущенный game-server (GAME_URL — другой адрес)
npm run db:generate         # после правки схемы — новая миграция в shared/drizzle
npm run build:world         # пересобрать карту и спрайты из art/reference.webp (нужен sharp)
npm run build:dig           # после неё — где на карте можно копать червей (shared/src/dig-data.ts)
docker compose up -d --build  # продакшен на VPS
```

## Правила

- Язык интерфейса, комментариев и коммитов — русский. Комментарии объясняют «зачем», в том же плотном стиле, что в коде.
- Новые сообщения клиент ⇄ сервер — сначала в `ClientMessages`/`ServerMessages` (`shared/src/protocol.ts`), на сервере — с zod-схемой в `onMessage`.
- Всё, что влияет на прогресс (улов, деньги, предметы), решает и записывает сервер. Клиенту не верить.
- Правила, нужные и клиенту, и серверу (скорости, расстояния, таблицы рыб), — только в `shared/`.
- Схему базы менять через `npm run db:generate` (миграции не править руками после того, как они применены где-то кроме своей машины).
- `shared/src/world-data.ts`, `shared/src/dig-data.ts`, картинки в `app/public/assets/` и `art/house/` генерирует `tools/build-world.mjs` — руками не править. Исключение — `bucket.png`: в репозитории лежит правленая версия, после сборки её нужно вернуть (`git checkout app/public/assets/bucket.png`).
- Перед коммитом: `npm run check`; если трогал сервер или протокол — `npm run smoke:own -w game-server`.
- Новое устройство или правило записывать в `CLAUDE.md` той части, где оно живёт; сюда — только то, что касается всех.

## Claude Code

- **Хуки** (`.claude/settings.json`, сам код — `.claude/hooks/rules.mjs`): сгенерированные сборкой файлы не дают править руками; после `build:world` возвращают `bucket.png`; в конце хода гоняют тесты и типы тех пакетов, что правились в сессии, и не дают закончить, пока они падают.
- **Скиллы** (`.claude/skills/`): `check` — проверки перед коммитом; `new-message` — новое сообщение клиент ⇄ сервер по шагам; `build-world` — пересборка карты; `verify-game` — проверка правки в самой игре через панель браузера.
- **Разрешения** там же: тесты, типы, бот, миграции и чтение git идут без вопросов. Личные настройки — в `.claude/settings.local.json` (в git не попадает).
