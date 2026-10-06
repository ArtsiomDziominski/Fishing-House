// Регистрация: имя + пароль → учётная запись, игровой профиль и сразу вход.
import { credentialsSchema } from '@fh/shared';
import { createAccount, NameTakenError } from '@fh/shared/server';

export default defineEventHandler(async event => {
  limit(event, 'register', 10, 600);
  const { name, password } = await readValid(event, credentialsSchema);
  try {
    const player = await createAccount(useDb(), name, await hashPassword(password));
    await setUserSession(event, { user: { id: player.id, name: player.name } });
    return player;
  } catch (err) {
    if (err instanceof NameTakenError) throw createError({ statusCode: 409, message: err.message });
    throw err;
  }
});
