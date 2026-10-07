# Образы для продакшена из одного Dockerfile:
#   docker build --target app  — сайт и API (Nuxt)
#   docker build --target game — игровой сервер (Colyseus) и миграции базы
# Обычно их собирает docker compose (docker-compose.yml).

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY game-server/package.json game-server/
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run build -w app && npm run build -w game-server

# Пакеты, которые нужны игровому серверу во время работы (общий код уже встроен в dist)
FROM node:22-alpine AS game-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY game-server/package.json game-server/
RUN npm ci --omit=dev --ignore-scripts -w game-server

FROM node:22-alpine AS app
WORKDIR /srv
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /repo/app/.output ./
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]

FROM node:22-alpine AS game
WORKDIR /srv
ENV NODE_ENV=production GAME_PORT=2567 MIGRATIONS_DIR=/srv/drizzle
COPY --from=game-deps /repo/node_modules ./node_modules
COPY --from=build /repo/game-server/dist ./dist
COPY --from=build /repo/shared/drizzle ./drizzle
USER node
EXPOSE 2567
CMD ["node", "dist/index.mjs"]
