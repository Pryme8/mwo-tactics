// Finds the MWO install and reports which build is on disk.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(ROOT, 'web', 'public', 'data');
const CONFIG = path.join(ROOT, 'mwo.config.json');

const looksLikeInstall = (dir) => dir && fs.existsSync(path.join(dir, 'Game', 'GameData.pak'));

function fromRegistry() {
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Piranha Games\\Mechwarrior Online\\Production\\Install',
    'HKLM\\SOFTWARE\\Piranha Games\\Mechwarrior Online\\Production\\Install',
  ];
  for (const key of keys) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', 'INSTALL_LOCATION'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/INSTALL_LOCATION\s+REG_SZ\s+(.+)/);
      if (m) return m[1].trim().replace(/[\\/]+$/, '');
    } catch { /* not installed through the portal */ }
  }
  return null;
}

function fromSteam() {
  const libs = new Set(['C:\\Program Files (x86)\\Steam']);
  try {
    const vdf = fs.readFileSync('C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf', 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
  } catch { /* no steam */ }
  for (const lib of libs) {
    const dir = path.join(lib, 'steamapps', 'common', 'MechWarrior Online');
    if (looksLikeInstall(dir)) return dir;
  }
  return null;
}

export function findInstall() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { /* first run */ }
  const candidates = [process.env.MWO_PATH, cfg.gamePath, fromRegistry(), fromSteam()];
  for (const c of candidates) {
    if (looksLikeInstall(c)) {
      if (cfg.gamePath !== c) fs.writeFileSync(CONFIG, JSON.stringify({ ...cfg, gamePath: c }, null, 2) + '\n');
      return c;
    }
  }
  throw new Error('Could not find MechWarrior Online. Set "gamePath" in mwo.config.json or the MWO_PATH environment variable.');
}

export function buildInfo(install) {
  let version = 'unknown';
  try {
    const xml = fs.readFileSync(path.join(install, 'build_info.xml'), 'utf8');
    version = (xml.match(/<BuildVersion>([^<]+)</) || [])[1] || version;
  } catch { /* keep unknown */ }
  const st = fs.statSync(path.join(install, 'Game', 'GameData.pak'));
  return { version, gameDataModified: st.mtime.toISOString(), gameDataSize: st.size };
}

export function writeJson(file, data, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pretty ? JSON.stringify(data, null, 1) : JSON.stringify(data));
}

export function readJson(file, dflt = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; }
}
