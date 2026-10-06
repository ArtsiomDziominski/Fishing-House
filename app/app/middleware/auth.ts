// Пускает на страницу только вошедших; остальных отправляет на вход и возвращает обратно после него.
export default defineNuxtRouteMiddleware(to => {
  const { loggedIn } = useUserSession();
  if (!loggedIn.value) return navigateTo({ path: '/login', query: { next: to.fullPath } });
});
