#!/usr/bin/env node
/**
 * Online-safe SQLite backup using VACUUM INTO.
 * Safe to run while the WbsWeb service is writing — captures a consistent snapshot.
 *
 * Usage:
 *   node scripts/backup.js [destination]
 *
 * If destination is omitted: writes ./backups/wbs_YYYYMMDD_HHmmss.db relative to cwd.
 * Source DB is read from DB_PATH env var, or ./data/wbs.db as fallback.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestamp() {
  const d = new Date();
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function main() {
  const src =
    process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'wbs.db');
  let dst = process.argv[2];
  if (!dst) {
    const dir = path.resolve(process.cwd(), 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    dst = path.join(dir, `wbs_${timestamp()}.db`);
  }

  if (!fs.existsSync(src)) {
    console.error(`Source DB not found: ${src}`);
    process.exit(1);
  }

  const dstDir = path.dirname(dst);
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
  if (fs.existsSync(dst)) {
    console.error(`Destination already exists: ${dst}`);
    process.exit(2);
  }

  const escaped = dst.replace(/'/g, "''");
  const db = new Database(src, { readonly: true });
  try {
    db.exec(`VACUUM INTO '${escaped}'`);
    const stat = fs.statSync(dst);
    console.log(`Backup written: ${dst} (${stat.size} bytes)`);
  } finally {
    db.close();
  }
}

main();
