// Публичный профиль игрока по id: имя, деньги, ведро, последние уловы. Видно всем, вход не нужен.
import { PLAYER_ID_RE } from '@fh/shared';
import { getProfile } from '@fh/shared/server';

export default defineEventHandler(async event => {
  const id = getRouterParam(event, 'id') || '';
  const profile = PLAYER_ID_RE.test(id) ? await getProfile(useDb(), id) : null;
  if (!profile) throw createError({ statusCode: 404, message: 'Такого игрока нет' });
  return profile;
});
