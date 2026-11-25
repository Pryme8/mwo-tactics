import { load, fetchJson, esc, noData } from '../store.js';
import { DATA } from '../lib/bin.js';

const CAT_LABEL = { weapons: 'Weapons', ammo: 'Ammo', engines: 'Engines', equipment: 'Equipment', jumpjets: 'Jump jets', masc: 'MASC', internals: 'Internals', upgrades: 'Upgrades', mechs: 'Mechs', omnipods: 'Omnipods', setBonuses: 'Omnipod set bonuses', skills: 'Skill tree' };
let root; let S; let selected = null; let filter = '';

export async function mount(el) {
  root = el; S = await load();
  if (!S.index?.latest) { el.innerHTML = noData(); return; }
  selected = [...S.index.patches].reverse().find((p) => p.previous)?.key ?? S.index.latest;
  render();
}

const show = (v) => (v === null || v === undefined ? '<span class="dim">–</span>' : typeof v === 'number' ? String(+v.toFixed(4)) : esc(v));
function delta(from, to) {
  if (typeof from !== 'number' || typeof to !== 'number' || from === 0) return '';
  const pct = (to / from - 1) * 100;
  return `<span class="${pct > 0 ? 'good' : 'bad'}">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</span>`;
}

async function render() {
  const patches = [...S.index.patches].reverse();
  const p = patches.find((x) => x.key === selected);
  let body;
  if (!p.previous) {
    body = `<div class="empty">This is the first snapshot (${esc(p.key)}), so there is nothing to compare it to yet.<br>
      After the next game patch, run <code>npm run scan</code> again: a new snapshot is stored next to this one and every stat that moved is listed here.</div>`;
  } else {
    const data = await fetchJson(`${DATA}/patches/${encodeURIComponent(p.key)}/changes.json`).catch(() => ({ changes: [] }));
    const q = filter.toLowerCase();
    const list = data.changes.filter((c) => !q || `${c.name} ${c.field ?? ''} ${c.cat}`.toLowerCase().includes(q));
    const byCat = new Map();
    for (const c of list) { if (!byCat.has(c.cat)) byCat.set(c.cat, []); byCat.get(c.cat).push(c); }
    body = `<p class="dim">${data.changes.length} changes from <b>${esc(p.previous)}</b> to <b>${esc(p.key)}</b></p>` + [...byCat].map(([cat, items]) => `
      <h2>${CAT_LABEL[cat] ?? cat} <span class="dim">(${items.length})</span></h2>
      <table><thead><tr><th>Item</th><th>Field</th><th class="num">Before</th><th class="num">After</th><th class="num">Change</th></tr></thead><tbody>
      ${items.slice(0, 600).map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${c.kind === 'changed' ? esc(c.field) : `<span class="${c.kind === 'added' ? 'good' : 'bad'}">${c.kind}</span>`}</td>
        <td class="num">${c.kind === 'changed' ? show(c.from) : ''}</td><td class="num">${c.kind === 'changed' ? show(c.to) : ''}</td><td class="num">${c.kind === 'changed' ? delta(c.from, c.to) : ''}</td></tr>`).join('')}
      </tbody></table>${items.length > 600 ? `<p class="dim">…and ${items.length - 600} more</p>` : ''}`).join('');
  }
  root.innerHTML = `<div class="page"><h1>Patch changes</h1>
    <p class="sub">Each scan of the game files is stored as a snapshot. When the stats differ from the previous snapshot, the exact fields that moved are listed here: weapon numbers, quirks, hardpoints, engine limits, omnipod bonuses and skill tree values.</p>
    <div class="bar"><select id="patch">${patches.map((x) => `<option value="${esc(x.key)}" ${x.key === selected ? 'selected' : ''}>${esc(x.key)} · ${new Date(x.scannedAt).toLocaleDateString()}${x.previous ? ` · ${x.changeCount} changes` : ' · first snapshot'}</option>`).join('')}</select>
    <input type="text" id="f" placeholder="Filter (e.g. ppc, cooldown, atlas)…" value="${esc(filter)}" /></div>${body}</div>`;
  root.querySelector('#patch').addEventListener('change', (e) => { selected = e.target.value; render(); });
  const f = root.querySelector('#f');
  f.addEventListener('change', () => { filter = f.value; render(); });
}
