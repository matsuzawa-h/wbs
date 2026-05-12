import type { Config } from 'drizzle-kit';
import { resolve, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';

const dbPath = process.env.DB_PATH ?? resolve(process.cwd(), 'data', 'wbs.db');

// Ensure parent directory exists - drizzle-kit/better-sqlite3 won't create it.
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

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
