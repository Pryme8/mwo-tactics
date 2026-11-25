import { load, esc, fmt, noData, titleCase } from '../store.js';
import { ROLES, STABLE, ROLE_LABEL as ROLE_NAME, ROLE_NOTE, TUNING } from '../lib/buildmath.js';

const ui = { wc: 'All', role: 'brawl', faction: 'All', q: '', stable: false };
let root; let S;

export async function mount(el) {
  root = el; S = await load();
  if (!S.ctx || !S.builds) { el.innerHTML = noData(); return; }
  render();
}

function render() {
  const { db, builds } = S;
  const key = ui.role + (ui.stable ? STABLE : '');
  const rows = db.mechs
    .filter((m) => !builds.mechs[m.id]?.sameAs && builds.mechs[m.id]?.roles[key]?.[0])
    .filter((m) => (ui.wc === 'All' || m.weightClass === ui.wc) && (ui.faction === 'All' || m.faction === ui.faction))
    .filter((m) => !ui.q || `${m.label} ${m.variant}`.toLowerCase().includes(ui.q.toLowerCase()))
    .map((m) => ({ m, b: builds.mechs[m.id], top: builds.mechs[m.id].roles[key][0], t: builds.mechs[m.id].tiers[key] }))
    .sort((a, b) => (ui.wc === 'All' ? (b.t?.rel ?? 0) - (a.t?.rel ?? 0) : b.top.score - a.top.score))
    .slice(0, 150);
  const seg = (key, vals, labels = {}) => `<span class="seg">${vals.map((v) => `<button data-k="${key}" data-v="${v}" class="${ui[key] === v ? 'on' : ''}">${labels[v] ?? v}</button>`).join('')}</span>`;
  root.innerHTML = `<div class="page">
    <h1>Current meta</h1>
    <p class="sub">Every mech's best generated build, ranked against the rest of its weight class for the chosen engagement range.
      <span class="tier S">S</span> = top 6% (meta), <span class="tier A">A</span> = next 14%, <span class="tier B">B</span> = next 30%.
      Scores come from the game files on your disk, so they follow every balance patch after a rescan. Reskins with identical stats are folded into one row.</p>
    <div class="bar">
      ${seg('role', ROLES, ROLE_NAME)}
      <button id="stable" class="${ui.stable ? 'on' : ''}" title="Prefer builds whose cooling keeps up with their heat, so they can fire without pausing">Heat stable</button>
      ${seg('wc', ['All', 'Light', 'Medium', 'Heavy', 'Assault'])}
      ${seg('faction', ['All', 'InnerSphere', 'Clan'], { InnerSphere: 'Inner Sphere' })}
      <input type="text" id="q" placeholder="Filter mechs…" value="${esc(ui.q)}" />
      
    </div>
    <p class="dim small"><b>${ROLE_NAME[ui.role]}</b> (${TUNING.roleRange[ui.role]} m): ${ROLE_NOTE[ui.role]} Mechs that cannot fill the role are left out.${ui.stable ? ' <b>Heat stable:</b> ranked by builds that can fire non-stop without building heat.' : ''}</p>
    <table><thead><tr><th>#</th><th>Tier</th><th>Mech</th><th>Class</th><th class="num">Tons</th><th>Best build</th><th class="num">Score</th><th class="num">vs class best</th><th class="num">vs stock</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="click" data-id="${r.m.id}">
      <td class="dim">${ui.wc === 'All' ? i + 1 : r.t?.rank ?? ''}</td>
      <td><span class="tier ${r.t?.tier ?? 'C'}">${r.t?.tier ?? '–'}</span></td>
      <td><b>${esc(titleCase(r.m.chassisLabel))}</b> <span class="dim">${esc(r.m.variant)}</span></td>
      <td class="dim">${r.m.weightClass} · ${r.m.faction === 'Clan' ? 'Clan' : 'IS'}</td>
      <td class="num">${r.m.tons}</td>
      <td>${esc(titleCase(r.top.title))}</td>
      <td class="num"><b>${fmt(r.top.score, 1)}</b></td>
      <td class="num">${r.t ? Math.round(r.t.rel * 100) + '%' : ''}</td>
      <td class="num ${r.b.stock ? 'good' : 'dim'}">${r.b.stock?.[key] ? '+' + Math.round((r.top.score / r.b.stock[key] - 1) * 100) + '%' : '–'}</td>
    </tr>`).join('')}</tbody></table></div>`;
  root.querySelector('#stable').addEventListener('click', () => { ui.stable = !ui.stable; render(); });
  root.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => { ui[b.dataset.k] = b.dataset.v; render(); }));
  const q = root.querySelector('#q');
  q.addEventListener('input', () => { ui.q = q.value; render(); const n = root.querySelector('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  root.querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/mechs/${tr.dataset.id}/${key}`; }));
}
