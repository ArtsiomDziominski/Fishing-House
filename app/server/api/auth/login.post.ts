// Вход по имени и паролю. Ошибка одна и та же, есть такое имя или нет, — чтобы нельзя было перебирать имена.
import { z } from 'zod';
import { findAccount } from '@fh/shared/server';

const body = z.object({ name: z.string().trim().min(1, 'Введите имя').max(64), password: z.string().min(1, 'Введите пароль').max(128) });

export default defineEventHandler(async event => {
  limit(event, 'login', 20, 600);
  const { name, password } = await readValid(event, body);
  const acc = await findAccount(useDb(), name);
  if (!acc || !(await verifyPassword(acc.passwordHash, password))) {
    throw createError({ statusCode: 401, message: 'Неверное имя или пароль' });
  }
  await setUserSession(event, { user: { id: acc.id, name: acc.name } });
  return { id: acc.id, name: acc.name };
});
