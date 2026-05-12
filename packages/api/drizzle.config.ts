import type { Config } from 'drizzle-kit';
import { resolve } from 'path';

const dbPath = process.env.DB_PATH ?? resolve(process.cwd(), 'data', 'wbs.db');

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
  strict: true,
} satisfies Config;
