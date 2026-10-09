// Билет на вход в игровой сервер — только для вошедших. Живёт минуту. Игрока в базе нет (её снесли, а cookie осталась) —
// сессию стираем и отвечаем 401: страница игры отправит на вход.
import { hasPlayer, issueTicket } from '@fh/shared/server';

export default defineEventHandler(async event => {
  const { user } = await requireUserSession(event);
  if (!(await hasPlayer(useDb(), user.id))) {
    await clearUserSession(event);
    throw createError({ statusCode: 401, message: 'Такого игрока больше нет — зарегистрируйтесь заново' });
  }
  return { ticket: issueTicket(user.id, user.name) };
});
