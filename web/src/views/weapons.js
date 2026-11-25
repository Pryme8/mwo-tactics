import { load, esc, fmt, noData, titleCase } from '../store.js';
import { weaponProfile, quirkTable } from '../lib/buildmath.js';

const ui = { faction: 'All', type: 'All', sort: 'dpsTon', dir: -1, skills: false };
let root; let S;

export async function mount(el) {
  root = el; S = await load();
  if (!S.ctx) { el.innerHTML = noData(); return; }
  render();
}

const COLS = [
  ['label', 'Weapon'], ['type', 'Type'], ['tons', 'Tons', 2], ['slots', 'Slots', 0], ['alpha', 'Damage', 1], ['alphaHeat', 'Heat', 1], ['cycle', 'Cycle s', 2],
  ['dps', 'DPS', 2], ['hps', 'Heat/s', 2], ['dpsTon', 'DPS/ton', 2], ['dmgHeat', 'Dmg/heat', 1], ['optimal', 'Optimal m', 0], ['max', 'Max m', 0], ['speed', 'Velocity', 0], ['burn', 'Burn s', 2], ['ghost', 'Ghost at', 0],
];

function render() {
  const { db, ctx } = S;
  const rows = db.weapons.filter((w) => ['Ballistic', 'Energy', 'Missile'].includes(w.type) && (w.stats.damage ?? 0) > 0 && w.artemisRestrictedTo !== 3050)
    .filter((w) => (ui.faction === 'All' || w.faction.includes(ui.faction)) && (ui.type === 'All' || w.type === ui.type))
    .map((w) => {
      const fac = w.faction.includes('Clan') && !w.faction.includes('InnerSphere') ? 'Clan' : 'InnerSphere';
      const p = weaponProfile(w, ui.skills ? quirkTable(ctx.skillBonus[fac]) : new Map());
      return { ...p, clan: fac === 'Clan', dpsTon: p.dps / Math.max(0.25, p.tons), dmgHeat: p.alphaHeat > 0 ? p.alpha / p.alphaHeat : Infinity, ghost: Number.isFinite(p.penaltyLevel) ? p.penaltyLevel : 0 };
    });
  rows.sort((a, b) => { const x = a[ui.sort]; const y = b[ui.sort]; return (typeof x === 'string' ? x.localeCompare(y) : (x === y ? 0 : x > y ? 1 : -1)) * ui.dir; });
  const seg = (key, vals, labels = {}) => `<span class="seg">${vals.map((v) => `<button data-k="${key}" data-v="${v}" class="${String(ui[key]) === String(v) ? 'on' : ''}">${labels[v] ?? v}</button>`).join('')}</span>`;
  root.innerHTML = `<div class="page">
    <h1>Weapons</h1>
    <p class="sub">Live numbers from the installed game files. Damage counts every projectile in a trigger pull; ultra autocannons include the double tap and expected jam time; "Ghost at" is how many can fire together before the heat penalty starts.</p>
    <div class="bar">${seg('faction', ['All', 'InnerSphere', 'Clan'], { InnerSphere: 'Inner Sphere' })} ${seg('type', ['All', 'Ballistic', 'Energy', 'Missile'])}
      <button id="skills" class="${ui.skills ? 'on' : ''}">With full firepower skill tree</button><span class="dim">${rows.length} weapons</span></div>
    <table><thead><tr>${COLS.map(([k, l]) => `<th data-s="${k}" class="${k === 'label' || k === 'type' ? '' : 'num'}">${l}${ui.sort === k ? (ui.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${COLS.map(([k, , d]) => {
      if (k === 'label') return `<td><b>${esc(titleCase(r.label))}</b></td>`;
      if (k === 'type') return `<td><span class="tag ${r.type}">${r.type}</span></td>`;
      const v = r[k];
      return `<td class="num">${v === 0 && ['speed', 'burn', 'ghost', 'alphaHeat', 'hps'].includes(k) ? '<span class="dim">–</span>' : (Number.isFinite(v) ? fmt(v, d) : '∞')}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
  root.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => { ui[b.dataset.k] = b.dataset.v; render(); }));
  root.querySelector('#skills').addEventListener('click', () => { ui.skills = !ui.skills; render(); });
  root.querySelectorAll('th[data-s]').forEach((th) => th.addEventListener('click', () => { if (ui.sort === th.dataset.s) ui.dir *= -1; else { ui.sort = th.dataset.s; ui.dir = th.dataset.s === 'label' ? 1 : -1; } render(); }));
}
