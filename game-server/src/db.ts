// Одно подключение к базе на процесс игрового сервера.
import { createDb } from '@fh/shared/server';

export const db = createDb();
