// Shared locations for the app's server, graph builder and usage scanner.
// Everything the app writes (backups, alerts, settings, names, usage cache) goes to DATA, never into the repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = os.homedir();
export const H = path.join(HOME, '.claude', 'harness');
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const SKILLS = path.join(HOME, '.claude', 'skills');
export const TASKS = path.join(HOME, '.claude', 'scheduled-tasks');
export const DATA = process.env.HARNESS_APP_DATA || path.join(H, 'app-data');
fs.mkdirSync(DATA, { recursive: true });

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const exp = (p) => String(p || '').replace(/^~(?=\/|$)/, HOME);

// The person this install works for (written by setup).
export const USER = { name: 'You', company: 'Company', timezone: '', ...(readJSON(path.join(H, 'user.json')) || {}) };
export const COMPANY = USER.company || 'Company';
export const COMPANY_SLUG = String(COMPANY).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';

// The company skill tree: the repo's skills/ folder unless sources.json says otherwise.
const src = readJSON(path.join(H, 'sources.json'));
export const TREE = src?.skillTree?.root ? exp(src.skillTree.root) : path.join(REPO, 'skills');

// IANA time zone for "today" and the usage day boundary; falls back to this computer's zone.
const valid = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
export const TZ = USER.timezone && valid(USER.timezone) ? USER.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
