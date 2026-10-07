// Одно подключение к базе на процесс сайта, создаётся при первом запросе.
import { createDb, type Db } from '@fh/shared/server';

let db: Db | null = null;
export const useDb = (): Db => (db ??= createDb());
