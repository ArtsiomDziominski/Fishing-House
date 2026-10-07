// Билет на вход в игровой сервер — только для вошедших. Живёт минуту.
import { issueTicket } from '@fh/shared/server';

export default defineEventHandler(async event => {
  const { user } = await requireUserSession(event);
  return { ticket: issueTicket(user.id, user.name) };
});
