// Правила для имени и пароля — одни для формы в браузере и для API.

import { z } from 'zod';

export const NAME_MIN = 3, NAME_MAX = 20, PASSWORD_MIN = 8, PASSWORD_MAX = 128;
export const NAME_RE = /^[\p{L}\p{N}_-]+$/u;

export const nameSchema = z.string().trim()
  .min(NAME_MIN, `Имя — от ${NAME_MIN} символов`)
  .max(NAME_MAX, `Имя — не длиннее ${NAME_MAX} символов`)
  .regex(NAME_RE, 'Имя — только буквы, цифры, _ и -');
export const passwordSchema = z.string()
  .min(PASSWORD_MIN, `Пароль — от ${PASSWORD_MIN} символов`)
  .max(PASSWORD_MAX, `Пароль — не длиннее ${PASSWORD_MAX} символов`);

export const credentialsSchema = z.object({ name: nameSchema, password: passwordSchema });
export type Credentials = z.infer<typeof credentialsSchema>;

// Имена сравниваются без учёта регистра: «Рыбак» и «рыбак» — одно имя.
export const loginKey = (name: string) => name.trim().toLowerCase();

// Публичный id игрока — по нему открывается профиль /player/<id>.
export const PLAYER_ID_RE = /^[a-z0-9]{10}$/;
