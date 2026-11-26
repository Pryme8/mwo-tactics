// Bonus explorer: rank every mech by one quirk, or by everything that applies to one weapon.
import { load, esc, fmt, noData, titleCase } from '../store.js';
import { CATS, quirkIndex, parseQuirk, valueText, isGood, goodness, weaponBoard, WEAPON_STATS } from '../lib/quirks.js';

const ui = { mode: 'q', find: '', name: null, weapon: null, stat: 'dps', wc: 'All', faction: 'All' };
let root; let S; let qi;

export async function mount(el, rest) {
  root = el; S = await load();
  if (!S.ctx) { el.innerHTML = noData(); return; }
  qi = quirkIndex(S);
  el.innerHTML = `<div class="cols"><div class="side"><div class="bar">
      <span class="seg" id="mode" style="width:100%"><button data-m="q" style="flex:1">By bonus</button><button data-m="w" style="flex:1">By weapon</button></span>
      <input type="text" id="find" placeholder="Search…" style="flex:1;min-width:0" />
    </div><div class="list" id="list"></div></div><div class="detail" id="detail"></div></div>`;
  el.querySelector('#find').addEventListener('input', (e) => { ui.find = e.target.value; renderList(); });
  el.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.m === 'q' ? `#/quirks/q/${ui.name ?? ''}` : `#/quirks/w/${ui.weapon ?? ''}/${ui.stat}`; }));
  update(rest);
}

export function update(rest) {
  const [mode, a, b] = rest ?? [];
  if (mode === 'q' || mode === 'w') ui.mode = mode;
  if (mode === 'q' && a && qi.byName.has(decodeURIComponent(a))) ui.name = decodeURIComponent(a);
  if (mode === 'w' && a && S.ctx.weapon.get(+a)) ui.weapon = +a;
  if (mode === 'w' && b && WEAPON_STATS.some(([k]) => k === b)) ui.stat = b;
  if (!ui.name) ui.name = qi.quirks.find((x) => x.q.cat === 'weapon')?.q.name ?? qi.quirks[0].q.name;
  if (!ui.weapon) ui.weapon = weapons()[0].id;
  root.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x.dataset.m === ui.mode));
  renderList(); renderDetail();
}

const weapons = () => S.db.weapons.filter((w) => ['Ballistic', 'Energy', 'Missile'].includes(w.type) && (w.stats.damage ?? 0) > 0 && w.artemisRestrictedTo !== 3050);
const isClan = (w) => w.faction.includes('Clan') && !w.faction.includes('InnerSphere');

function renderList() {
  const el = root.querySelector('#list'); const f = ui.find.trim().toLowerCase();
  let html = '';
  if (ui.mode === 'q') {
    for (const [cat, title] of CATS) {
      const items = qi.quirks.filter((x) => x.q.cat === cat && (!f || x.q.label.toLowerCase().includes(f) || x.q.name.includes(f)));
      if (!items.length) continue;
      html += `<div class="lhead">${title}</div>` + items.map((x) => `<div class="item ${x.q.name === ui.name ? 'on' : ''}" data-h="#/quirks/q/${encodeURIComponent(x.q.name)}">
        <span class="nm">${esc(x.q.label)}</span><small>best ${valueText(x.q, x.best)} · ${x.list.length}</small></div>`).join('');
    }
  } else {
    for (const type of ['Ballistic', 'Energy', 'Missile']) {
      const items = weapons().filter((w) => w.type === type && (!f || w.label.toLowerCase().includes(f))).sort((a, b) => isClan(a) - isClan(b) || a.label.localeCompare(b.label));
      if (!items.length) continue;
      html += `<div class="lhead">${type}</div>` + items.map((w) => `<div class="item ${w.id === ui.weapon ? 'on' : ''}" data-h="#/quirks/w/${w.id}/${ui.stat}">
        <span class="nm">${esc(titleCase(w.label))}</span><small>${isClan(w) ? 'Clan' : 'IS'}</small></div>`).join('');
    }
  }
  el.innerHTML = html || '<div class="empty">Nothing matches.</div>';
  el.querySelectorAll('.item').forEach((it) => it.addEventListener('click', () => { location.hash = it.dataset.h; }));
}

const hpTags = (hp) => ['Ballistic', 'Energy', 'Missile'].filter((t) => hp[t]).map((t) => `<span class="tag ${t}">${hp[t]} ${t[0]}</span>`).join('');

function board(list, q, extra) {
  const shown = list.filter((x) => (ui.wc === 'All' || x.row.mech.weightClass === ui.wc) && (ui.faction === 'All' || x.row.mech.faction === ui.faction));
  const top = Math.max(...list.map((x) => Math.abs(x.v)), 1e-9);
  let rank = 0; let last = null;
  return `<div class="bar"><span class="seg">${['All', 'Light', 'Medium', 'Heavy', 'Assault'].map((v) => `<button data-k="wc" data-v="${v}" class="${ui.wc === v ? 'on' : ''}">${v}</button>`).join('')}</span>
      <span class="seg">${[['All', 'All tech'], ['InnerSphere', 'Inner Sphere'], ['Clan', 'Clan']].map(([v, l]) => `<button data-k="faction" data-v="${v}" class="${ui.faction === v ? 'on' : ''}">${l}</button>`).join('')}</span>
      <span class="dim">${shown.length} mechs${shown.length > 200 ? ', top 200 shown' : ''}</span></div>
    <div class="card qboard">${shown.slice(0, 200).map((x, i) => {
    if (last === null || Math.abs(x.v - last) > 1e-9) rank = i + 1; last = x.v;
    const m = x.row.mech; const good = isGood(q, x.v);
    return `<a class="qrow" href="#/mechs/${m.id}">
        <span class="rk">${rank}</span>
        <span class="nm">${x.row.tier ? `<span class="tier ${x.row.tier}">${x.row.tier}</span> ` : ''}<b>${esc(titleCase(m.chassisLabel))}</b> <span class="dim">${esc(m.variant)} · ${m.tons} t</span></span>
        <span class="hps">${hpTags(x.row.hp)}</span>
        <span class="qbar ${good ? '' : 'neg'}"><i style="width:${Math.max(2, (Math.abs(x.v) / top) * 100)}%"></i></span>
        <span class="val ${good ? 'good' : 'bad'}">${valueText(q, x.v)}</span>
        ${extra ? `<span class="more">${extra(x)}</span>` : ''}</a>`;
  }).join('') || '<div class="dim">No mech has this in the current filter.</div>'}</div>`;
}

function renderDetail() {
  const el = root.querySelector('#detail');
  if (ui.mode === 'q') {
    const entry = qi.quirks.find((x) => x.q.name === ui.name); const { q } = entry;
    const worse = entry.list.filter((x) => !isGood(q, x.v)).length;
    el.innerHTML = `<div class="page"><h1>${esc(q.label)}</h1>
      <p class="sub">${entry.list.length} variants have this bonus, ranked best first${q.lowerBetter ? ' (lower is better here, so the biggest reduction leads)' : ''}.${worse ? ` ${worse} of them get it as a penalty, shown in red.` : ''}
        ${/^total_/.test(q.name) ? 'This adds up the per-location quirks; a flat "every location" quirk is listed separately.' : ''} Copies of a variant with identical stats are listed once. Click a mech to open its builds.</p>
      ${board(entry.list, q)}</div>`;
  } else {
    const w = S.ctx.weapon.get(ui.weapon);
    const stats = WEAPON_STATS.map(([k, l]) => ({ k, l, b: weaponBoard(S, w, k) })).filter((x) => x.b.list.length);
    const cur = stats.find((x) => x.k === ui.stat) ?? stats[0];
    const result = (x) => {
      const p = x.p; const b = cur.b.base;
      const fig = { dps: `${fmt(p.dps, 2)} dps <span class="dim">(stock ${fmt(b.dps, 2)})</span>`, cooldown: `${fmt(p.cycle, 2)} s cycle <span class="dim">(${fmt(b.cycle, 2)})</span>`, heat: `${fmt(p.alphaHeat, 1)} heat <span class="dim">(${fmt(b.alphaHeat, 1)})</span>`,
        range: `${fmt(p.optimal, 0)} m <span class="dim">(${fmt(b.optimal, 0)})</span>`, velocity: `${fmt(p.speed, 0)} m/s <span class="dim">(${fmt(b.speed, 0)})</span>`, duration: `${fmt(p.burn, 2)} s burn <span class="dim">(${fmt(b.burn, 2)})</span>`,
        rof: `${fmt(p.dps, 2)} dps <span class="dim">(${fmt(b.dps, 2)})</span>`, minheatpenaltylevel: Number.isFinite(p.penaltyLevel) ? `fire ${p.penaltyLevel} together` : '' }[cur.k] ?? '';
      return `<b>${fig}</b> ${x.parts.map((pt) => `<span class="quirk">${esc(pt.label)} ${pt.text}</span>`).join('')}`;
    };
    el.innerHTML = `<div class="page"><h1>${esc(titleCase(w.label))} <span class="tag ${w.type}">${w.type}</span></h1>
      <p class="sub">Every mech that can mount this weapon, with all the quirks that apply to it added together: the "all weapons" ones, the ${w.type.toLowerCase()} ones and the ones for its own family. The chips show where each total comes from. No skill tree bonuses are included.</p>
      ${cur ? `<div class="bar"><span class="seg">${stats.map((x) => `<button data-stat="${x.k}" class="${x.k === cur.k ? 'on' : ''}">${x.l}</button>`).join('')}</span></div>${board(cur.b.list, cur.b.q, result)}` : '<div class="empty">No mech has a quirk that affects this weapon.</div>'}</div>`;
    el.querySelectorAll('button[data-stat]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/quirks/w/${ui.weapon}/${b.dataset.stat}`; }));
  }
  el.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => { ui[b.dataset.k] = b.dataset.v; renderDetail(); }));
  el.scrollTop = 0;
}
