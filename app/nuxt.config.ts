// Сайт и API: меню, вход, регистрация, профили игроков и сама игра в /play.
// Игровой сервер (Colyseus) — отдельный процесс в ../game-server; браузер ходит к нему по runtimeConfig.public.gameUrl.

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['nuxt-auth-utils', '@pinia/nuxt'],
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      title: 'Fishing House',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' },
        { name: 'description', content: 'Уютная пиксельная онлайн-игра: домик рыбака у реки и общий причал' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/assets/icon.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Tiny5&display=swap' },
      ],
    },
  },
  runtimeConfig: {
    public: {
      gameUrl: 'http://localhost:2567',   // NUXT_PUBLIC_GAME_URL; путь вроде /game — от адреса сайта
    },
  },
  routeRules: {
    '/play': { ssr: false },              // игра живёт только в браузере: canvas и WebSocket
  },
  build: { transpile: ['@fh/shared'] },   // общий код лежит исходниками TypeScript
  typescript: { strict: true },
});
