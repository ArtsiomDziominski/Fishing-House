// Тело запроса по схеме zod; не подошло — 400 с понятным текстом первой проблемы.
import type { H3Event } from 'h3';
import type { z } from 'zod';

export async function readValid<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.infer<T>> {
  const body = await readBody(event).catch(() => null);
  const res = schema.safeParse(body);
  if (!res.success) throw createError({ statusCode: 400, message: res.error.issues[0]?.message || 'Неверные данные' });
  return res.data;
}
