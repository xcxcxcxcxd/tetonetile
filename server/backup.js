// Command-line backup: a consistent copy of the database plus every uploaded file
// (photos, PDFs), in one dated folder. Safe while the app is running.
//
//   npm run backup                      -> data/backups/zelligerar-<date>/
//   npm run backup -- /mnt/usb/backups  -> /mnt/usb/backups/zelligerar-<date>/
//
// Restore: stop the app, copy zelligerar.db over data/zelligerar.db and the
// uploads folder over data/uploads, start the app again.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

const target = path.resolve(process.argv[2] || config.backupDir);
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const dir = path.join(target, `zelligerar-${stamp}`);

if (!fs.existsSync(config.dbFile)) {
  console.error(`No database at ${config.dbFile}. Set DATA_DIR or DB_FILE if it is elsewhere.`);
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
const db = new Database(config.dbFile, { fileMustExist: true });
await db.backup(path.join(dir, 'zelligerar.db'));
db.close();
let files = 0;
if (fs.existsSync(config.uploadDir)) {
  fs.cpSync(config.uploadDir, path.join(dir, 'uploads'), { recursive: true });
  files = fs.readdirSync(config.uploadDir).length;
}
console.log(`Backup written to ${dir} (database + ${files} uploaded file${files === 1 ? '' : 's'}).`);
