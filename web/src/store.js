// Loads the scanned game data once and shares it between views.
import { indexDb } from './lib/buildmath.js';
import { DATA } from './lib/bin.js';

const state = { index: null, db: null, ctx: null, builds: null, loading: null };

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export async function load() {
  if (!state.loading) {
    state.loading = (async () => {
      state.index = await json(`${DATA}/index.json`).catch(() => null);
      if (!state.index?.latest) return state;
      const base = `${DATA}/patches/${encodeURIComponent(state.index.latest)}`;
      state.db = await json(`${base}/db.json`);
      state.ctx = indexDb(state.db);
      state.builds = await json(`${base}/builds.json`).catch(() => null);
      state.mechById = new Map(state.db.mechs.map((m) => [m.id, m]));
      return state;
    })();
  }
  return state.loading;
}

export const fetchJson = json;
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');
export const noData = () => `<div class="empty">No game data has been scanned yet.<br>Run <code>npm run scan</code> then <code>npm run builds</code> in the project folder and reload.</div>`;

export function titleCase(s) {
  return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Ac|Lrm|Srm|Mrm|Atm|Ppc|Er|Lb|Uac|Ams|Ecm|Xl|Iic|Ii|Iii|Hag|Rac|Lpl|Mpl)\b/g, (m) => m.toUpperCase());
}
