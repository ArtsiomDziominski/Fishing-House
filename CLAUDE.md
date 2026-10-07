# Fishing House — заметки для работы над проектом

Уютная пиксельная онлайн-игра: общий причал, вход по имени и паролю, прогресс в базе. Цель по нагрузке — до 1000 игроков одновременно.

## Стек (решено, не менять без обсуждения)

| Часть | Что | Где |
|---|---|---|
| Фронт | Nuxt 4 + Vue 3 + TypeScript + Pinia; игра на canvas в `/play` | `app/` |
| API | Nuxt (Nitro): вход, регистрация, профили, билеты в игру; дальше — инвентарь, магазин | `app/server/` |
| Игровой сервер | Colyseus 0.18, несколько процессов + Redis | `game-server/` |
| База | PostgreSQL + Drizzle ORM | схема `shared/src/server/schema.ts`, миграции `shared/drizzle/` |
| Общий код | правила рыбалки, карта, рыбы, протокол, типы | `shared/` |
| Хостинг | VPS + Docker Compose + Caddy | `docker-compose.yml`, `Caddyfile`, `Dockerfile` |

## Как устроено

- **Монорепо на npm workspaces**: `shared`, `app`, `game-server`. `@fh/shared` подключается исходниками TypeScript (без сборки): в Nuxt через `build.transpile`, в игровом сервере — `tsx` в разработке и esbuild-бандл (`game-server/build.mjs`) в продакшене.
- **`@fh/shared`** работает и в браузере, и в Node. **`@fh/shared/server`** — только для серверов (база, билеты, `node:crypto`); в код `app/app/` его не импортировать, кроме `import type`.
- **Вход**: `nuxt-auth-utils`, сессия в зашифрованной cookie: `user = { id, name }`, где `id` — публичный id игрока (10 символов `[a-z0-9]`). Пароли — `hashPassword`/`verifyPassword` (scrypt).
- **В игру**: страница `/play` берёт у сайта билет (`POST /api/game/ticket`, HMAC общим `GAME_SECRET`, живёт минуту) и входит в комнату `pier` на Colyseus. `onAuth` комнаты проверяет билет и кладёт `id` игрока в `client.auth.id` — по нему `UniqueSessionPlugin` выбивает старую вкладку (причина `replaced`).
- **Кто главный**: сервер. Клиент ходит сам и шлёт место раз в 0,1 с; сервер проверяет проходимость и скорость (запас хода) и при несогласии шлёт `self`. Рыбалку целиком ведёт сервер (`createFishing` в `shared/src/fishing.ts`): клюёт, кто клюнул, успел ли подсечь (+`HOOK_GRACE` на задержку сети). Клиент лишь показывает фазы (`app/app/game/fishing-view.ts`).
- **Что видят другие** — только состояние комнаты (`game-server/src/state.ts`: место, поза, ведро, рюкзак, хвосты рыб). Ведро и рыбалку игрок получает личными сообщениями (`ServerMessages` в `shared/src/protocol.ts`).
- **Рюкзак**: лежит в мире, как ведро, либо надет (`WorldState.pack`); вид — один из `PACK_KINDS` (`shared/src/packs.ts`), это расцветка рюкзака с картинки. Пока только внешний вид: надеть, снять и сменить вид можно свободно, но всё идёт через сервер (`packOn`, `packOff`, `packKind`).
- **Сохранение**: улов — сразу при подсечке (`catches`); место героя, ведра и рюкзака (`players.world`, jsonb) — при выходе и раз в минуту. В старых записях рюкзака нет — `cleanWorld` кладёт его у дома.
- **Масштаб**: в комнате до `ROOM_SIZE` = 50 игроков, дальше матчмейкер открывает новую копию причала. Процессы игрового сервера связаны через Redis (`REDIS_URL`); каждый знает свой внешний адрес (`PUBLIC_ADDRESS`, например `domain/game/1`), Caddy ведёт `/game/N/*` на процесс N, а `/game/*` (матчмейкинг) — на любой.

## Команды

```bash
npm install                 # все пакеты сразу
cp .env.example .env        # и поменять секреты
npm run db:up               # Postgres и Redis для разработки (docker-compose.dev.yml)
npm run db:migrate          # применить миграции
npm run dev                 # сайт :3000 и игровой сервер :2567 вместе
npm test                    # тесты общего кода (node --test)
npm run typecheck           # типы во всех пакетах
npm run smoke -w game-server  # бот проходит игру через настоящий сервер (нужны база и запущенный game-server)
npm run db:generate         # после правки схемы — новая миграция в shared/drizzle
npm run build:world         # пересобрать карту и спрайты из art/reference.webp (нужен sharp)
docker compose up -d --build  # продакшен на VPS
```

## Правила

- Язык интерфейса, комментариев и коммитов — русский. Комментарии объясняют «зачем», в том же плотном стиле, что в коде.
- Новые сообщения клиент ⇄ сервер — сначала в `ClientMessages`/`ServerMessages` (`shared/src/protocol.ts`), на сервере — с zod-схемой в `onMessage`.
- Всё, что влияет на прогресс (улов, деньги, предметы), решает и записывает сервер. Клиенту не верить.
- Правила, нужные и клиенту, и серверу (скорости, расстояния, таблицы рыб), — только в `shared/`.
- Схему базы менять через `npm run db:generate` (миграции не править руками после того, как они применены где-то кроме своей машины).
- `shared/src/world-data.ts` и картинки в `app/public/assets/` генерирует `tools/build-world.mjs` — руками не править.
- Перед коммитом: `npm test`, `npm run typecheck`; если трогал сервер или протокол — `npm run smoke -w game-server`.
