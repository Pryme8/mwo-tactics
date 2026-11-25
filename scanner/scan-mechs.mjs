// Pre-exports mech geometry for the 3D build view.
// Usage: node scanner/scan-mechs.mjs [chassis ...]     (no arguments = every chassis)
// The dev server also exports a chassis on demand the first time you open it.
import path from 'node:path';
import { GameFS } from './lib/pak.mjs';
import { exportMech } from './lib/mechexport.mjs';
import { findInstall, readJson, DATA_DIR } from './lib/game.mjs';

const install = findInstall();
const gfs = new GameFS(path.join(install, 'Game'));
const index = readJson(path.join(DATA_DIR, 'index.json'));
const db = index?.latest ? readJson(path.join(DATA_DIR, 'patches', index.latest, 'db.json')) : null;
const all = db ? [...new Set(db.mechs.map((m) => m.chassis))] : [];
const wanted = process.argv.slice(2).map((s) => s.toLowerCase());
const list = wanted.length ? wanted : all;
let total = 0;
for (const chassis of list) {
  const r = exportMech(gfs, chassis);
  if (!r) { console.log(`  ${chassis}: no model`); continue; }
  total += r.bytes;
  console.log(`  ${chassis.padEnd(18)} ${String(Object.keys(r.pieces).length).padStart(4)} pieces  ${String(Math.round(r.tris / 1000)).padStart(4)}k tris  ${(r.bytes / 1e6).toFixed(1)}MB`);
}
console.log(`Done: ${(total / 1e6).toFixed(0)}MB`);
