import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { dirname, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import * as schema from './schema';

export type AppDb = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | null = null;
let dbInstance: AppDb | null = null;

export function getDbPath(): string {
  return process.env.DB_PATH ?? resolve(process.cwd(), 'data', 'wbs.db');
}

export function getDb(): AppDb {
  if (!dbInstance) {
    const dbPath = getDbPath();
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    dbInstance = drizzle(sqlite, { schema });
  }
  return dbInstance;
}

export function getRawSqlite(): Database.Database {
  getDb();
  if (!sqlite) {
    throw new Error('SQLite instance not initialised');
  }
  return sqlite;
}

export function closeDb(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    dbInstance = null;
  }
}

export * from './schema';
