// Что лежит в cookie входа (зашифровано): только публичный id игрока и имя. Пароль и учётная запись — никогда.
declare module '#auth-utils' {
  interface User {
    id: string;
    name: string;
  }
}

export {};
