import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');

export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  dbFile: process.env.DB_FILE || path.join(dataDir, 'zelligerar.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  backupDir: path.join(dataDir, 'backups'),
  // Address phones use to open QR codes, e.g. http://192.168.1.20:3000 or https://crm.example.com.
  // Can also be set in Settings > Company. Falls back to the address the browser used.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  secureCookies: process.env.SECURE_COOKIES === '1',
  trustProxy: process.env.TRUST_PROXY === '1',
};
