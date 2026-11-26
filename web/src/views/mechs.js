import { load, esc, fmt, noData, titleCase } from '../store.js';
import { mechFrame, evaluate, score, optimize, stockBuild, describeBuild, damageAt, precision, COMPONENTS, COMP_LABEL, TUNING, ROLES, ALL_ROLES, STABLE, ROLE_LABEL, ROLE_NOTE } from '../lib/buildmath.js';
import { buildCode, layoutSummary } from '../lib/buildcode.js';
import { pickSkills, skillCode, skillSummary, MAX_NODES } from '../lib/skillcode.js';

const ui = { q: '', wc: 'All', faction: 'All', tier: 'All', id: null, role: 'brawl', pick: 0, skills: true, stable: false, live: null };
const roleKey = () => ui.role + (ui.stable ? STABLE : '');
let root; let S; let mechView = null;

export async function mount(el, rest) {
  root = el; S = await load();
  if (!S.ctx) { el.innerHTML = noData(); return; }
  el.innerHTML = `<div class="cols"><div class="side"><div class="bar">
      <input type="text" id="q" placeholder="Search mechs…" style="flex:1;min-width:0" />
      <select id="wc"><option>All</option><option>Light</option><option>Medium</option><option>Heavy</option><option>Assault</option></select>
      <select id="fa"><option value="All">All tech</option><option value="InnerSphere">Inner Sphere</option><option value="Clan">Clan</option></select>
      <select id="ti"><option value="All">Any tier</option><option value="S">S (meta)</option><option value="A">A or better</option><option value="B">B or better</option></select>
    </div><div class="list" id="list"></div></div><div class="detail" id="detail"></div></div>`;
  const bind = (id, key, ev = 'change') => el.querySelector(id).addEventListener(ev, (e) => { ui[key] = e.target.value; renderList(); });
  bind('#q', 'q', 'input'); bind('#wc', 'wc'); bind('#fa', 'faction'); bind('#ti', 'tier');
  update(rest);
}

export function update(rest) {
  const [id, role] = rest ?? [];
  if (id && S.mechById.has(+id)) { ui.id = +id; ui.pick = 0; ui.live = null; }
  if (role) { const [base, flag] = decodeURIComponent(role).split('+'); if (ROLES.includes(base)) { ui.role = base; ui.stable = flag === 'stable'; } }
  if (!ui.id) ui.id = S.db.mechs.find((m) => S.builds?.mechs[m.id]?.bestTier === 'S')?.id ?? S.db.mechs[0].id;
  renderList(); renderDetail();
}

export function dispose() { mechView?.dispose(); mechView = null; }

function renderList() {
  const order = 'SABC';
  const list = S.db.mechs.filter((m) => {
    const b = S.builds?.mechs[m.id];
    if (ui.wc !== 'All' && m.weightClass !== ui.wc) return false;
    if (ui.faction !== 'All' && m.faction !== ui.faction) return false;
    if (ui.tier !== 'All' && !(b?.bestTier && order.indexOf(b.bestTier) <= order.indexOf(ui.tier))) return false;
    return !ui.q || `${m.label} ${m.variant} ${m.chassis}`.toLowerCase().includes(ui.q.toLowerCase());
  }).sort((a, b) => a.tons - b.tons || a.chassis.localeCompare(b.chassis) || a.variant.localeCompare(b.variant));
  const el = root.querySelector('#list');
  el.innerHTML = list.slice(0, 600).map((m) => {
    const b = S.builds?.mechs[m.id];
    return `<div class="item ${m.id === ui.id ? 'on' : ''}" data-id="${m.id}">${b?.bestTier ? `<span class="tier ${b.bestTier}">${b.bestTier}</span>` : '<span class="tier C">–</span>'}
      <span class="nm">${esc(titleCase(m.chassisLabel))} <small>${esc(m.variant)}</small></span><small>${m.tons}t</small></div>`;
  }).join('') || '<div class="empty">No mechs match.</div>';
  el.querySelectorAll('.item').forEach((it) => it.addEventListener('click', () => { location.hash = `#/mechs/${it.dataset.id}/${roleKey()}`; }));
}

function quirkHtml(q) {
  const mult = /_multiplier$/.test(q.name);
  const label = q.name.replace(/_(multiplier|additive)$/, '').replace(/_/g, ' ');
  // lower is better for these stats
  const lowerBetter = /cooldown|heat(?!dissipation)|spread|duration|jamchance|jamduration|receiving|falldamage|screenshake|overheatdamage/.test(q.name) && !/minheatpenalty|maxheat/.test(q.name);
  const good = lowerBetter ? q.value < 0 : q.value > 0;
  const val = mult ? `${q.value > 0 ? '+' : ''}${(q.value * 100).toFixed(1).replace(/\.0$/, '')}%` : `${q.value > 0 ? '+' : ''}${q.value}`;
  return `<span class="quirk ${good ? '' : 'neg'}">${esc(label)} ${val}</span>`;
}

function unpack(packed) {
  const b = packed.build;
  return { ...b, engine: S.ctx.item.get(b.engine), weapons: [...b.weapons], ammo: { ...b.ammo } };
}

function buildsFor(mech) {
  if (ui.live) return ui.live;
  const entry = S.builds?.mechs[mech.id];
  const out = {};
  for (const r of ALL_ROLES) out[r] = (entry?.roles[r] ?? []).map((p) => ({ title: p.title, build: unpack(p) }));
  return out;
}

function renderDetail() {
  const mech = S.mechById.get(ui.id);
  const el = root.querySelector('#detail');
  const { ctx } = S;
  const frame = mechFrame(ctx, mech);
  const entry = S.builds?.mechs[mech.id];
  const all = buildsFor(mech);
  const opts = { skills: ui.skills };
  const stock = stockBuild(ctx, frame);
  const stockEv = stock ? evaluate(ctx, frame, stock, opts) : null;
  const list = all[roleKey()] ?? [];
  const rows = list.map((b) => { const ev = evaluate(ctx, frame, b.build, opts); return { ...b, ev, sc: score(frame, ev, roleKey()) }; });
  if (stockEv) rows.push({ title: describeBuild(ctx, stock), build: stock, ev: stockEv, sc: score(frame, stockEv, roleKey()), stock: true });
  const pick = rows[Math.min(ui.pick, rows.length - 1)];
  const top = rows[0]?.sc.total || 1;
  const sameAs = entry?.sameAs && entry.sameAs !== mech.id ? S.mechById.get(entry.sameAs) : null;

  const hp = COMPONENTS.map((c) => {
    const fc = frame.comps[c]; if (!fc) return '';
    const tags = Object.entries(fc.hardpoints).filter(([, n]) => n > 0).map(([t, n]) => `<span class="tag ${t}">${n} ${t[0]}</span>`).join('');
    return `<div><b>${COMP_LABEL[c]}</b>${tags || '<span class="dim small">–</span>'}<div class="dim small">${fc.free} slots · ${fc.hp} hp</div></div>`;
  }).join('');

  el.innerHTML = `<div class="page">
    <h1>${esc(titleCase(mech.chassisLabel))} <span class="dim">${esc(mech.variant)}</span>
      ${entry?.bestTier === 'S' ? '<span class="tag meta">META</span>' : ''}</h1>
    <p class="sub">${mech.tons} t ${mech.weightClass} · ${mech.faction === 'Clan' ? 'Clan' : 'Inner Sphere'}${mech.omni ? ' OmniMech' : ''} · engine ${mech.minEngine}${mech.maxEngine !== mech.minEngine ? '–' + mech.maxEngine : ' (fixed)'}
      ${frame.canECM ? ' · ECM capable' : ''}${frame.maxJJ ? ` · ${frame.maxJJ} jump jets` : ''}${sameAs ? ` · same stats as ${esc(sameAs.variant)}` : ''}</p>
    <div class="grid g2">
      <div class="card"><h3>Hardpoints</h3><div class="hp">${hp}</div>
        <h3 style="margin-top:12px">Quirks ${mech.omni ? '<span class="dim small">(with its own omnipod set)</span>' : ''}</h3>
        <div>${frame.quirks.filter((q) => !/xpbonus|cbillbonus/.test(q.name)).map(quirkHtml).join('') || '<span class="dim">None</span>'}</div></div>
      <div class="card"><h3>3D view <span class="dim small" id="mv-note"></span></h3><canvas id="mechcanvas"></canvas>
        <div class="bar" style="margin:8px 0 0"><span class="seg" id="mv-mode"><button data-m="visual" class="on">Model</button><button data-m="hit">Hit locations</button></span>
        <span class="dim small">Drag to orbit · wheel to zoom · weapons of the selected build in orange</span></div>
        <div class="small" style="margin-top:6px">${[['Head', '#ff4040'], ['CT', '#ffb826'], ['LT', '#4dbf66'], ['RT', '#4099ff'], ['Arms', '#8ce699'], ['Legs', '#bf80f2'], ['Rear', '#7a5a20']].map(([n, c]) => `<span style="color:${c};margin-right:9px">■ ${n}</span>`).join('')}</div></div>
    </div>
    <div class="card"><h3>Meta standing
        ${ROLES.map((r) => { const t = entry?.tiers?.[r + (ui.stable ? STABLE : '')]; return t ? `<span class="tag">${ROLE_LABEL[r]}: <span class="tier ${t.tier}">${t.tier}</span> #${t.rank}/${t.of} in class</span>` : ''; }).join('')}</h3>
      <div class="bar"><span class="seg">${ROLES.map((r) => `<button data-role="${r}" class="${ui.role === r ? 'on' : ''}">${ROLE_LABEL[r]}</button>`).join('')}</span>
        <button id="stable" class="${ui.stable ? 'on' : ''}" title="Prefer builds whose cooling keeps up with their heat, so they can fire without pausing">Heat stable</button>
        <button id="skills" class="${ui.skills ? 'on' : ''}">Skill tree bonuses</button>
        <button id="reopt" class="primary">Re-optimize now</button><span class="dim small" id="optnote">${ui.live ? 'Showing a fresh search run in your browser.' : ''}</span></div>
      ${rows.map((r, i) => `<div class="buildrow click" data-i="${i}" style="cursor:pointer;${i === ui.pick ? 'background:#1d262f;margin:0 -14px;padding-left:14px;padding-right:14px' : ''}">
        <span class="score">${fmt(r.sc.total, 1)}</span>
        <div class="title">${r.stock ? '<span class="tag">STOCK</span>' : `<span class="tag">#${i + 1}</span>`}${esc(titleCase(r.title))}</div>
        <div class="meter"><i style="width:${Math.min(100, (r.sc.total / top) * 100)}%;${r.stock ? 'background:var(--dim)' : ''}"></i></div>
        <div class="factors"><span>${esc(titleCase(r.build.engine.label))}</span><span>alpha <b>${fmt(r.ev.alpha, 0)}</b></span><span>DPS <b>${fmt(r.ev.dps, 1)}</b></span>
          <span>sustained <b>${fmt(r.ev.sustainedDps, 1)}</b></span><span>heat/alpha <b>${Math.round((r.ev.alphaHeat / r.ev.capacity) * 100)}%</b></span><span><b>${fmt(r.ev.kph, 0)}</b> kph</span>
          <span>${r.ev.totalSinks} sinks</span>${r.ev.valid ? '' : `<span class="bad">${esc(r.ev.problems[0])}</span>`}</div></div>`).join('') || '<div class="dim">No generated builds for this mech.</div>'}
      <p class="dim small" style="margin:8px 0 0"><b>${ROLE_LABEL[ui.role]}:</b> ${ROLE_NOTE[ui.role]}${ui.stable ? ' <b>Heat stable:</b> builds are marked down unless cooling covers at least 95% of the heat they make firing non-stop.' : ''}${!list.length ? ' This variant does not qualify, so it has no builds here.' : ''}</p>
    </div>
    ${pick ? detailCard(pick, frame, stockEv, rows) : ''}
  </div>`;

  el.querySelectorAll('button[data-role]').forEach((b) => b.addEventListener('click', () => { ui.role = b.dataset.role; ui.pick = 0; renderDetail(); }));
  el.querySelectorAll('.buildrow').forEach((b) => b.addEventListener('click', () => { ui.pick = +b.dataset.i; renderDetail(); }));
  el.querySelector('#stable').addEventListener('click', () => { ui.stable = !ui.stable; ui.pick = 0; renderDetail(); });
  el.querySelector('#skills').addEventListener('click', () => { ui.skills = !ui.skills; renderDetail(); });
  el.querySelector('#reopt').addEventListener('click', () => {
    el.querySelector('#optnote').textContent = 'Searching…';
    setTimeout(() => {
      const t = performance.now();
      const r = optimize(ctx, mech, { roles: ALL_ROLES, keep: 6, skills: ui.skills });
      ui.live = Object.fromEntries(ALL_ROLES.map((role) => [role, r.results[role].map((e) => ({ title: describeBuild(ctx, e.build), build: e.build }))]));
      ui.pick = 0; renderDetail();
      root.querySelector('#optnote').textContent = `Tried ${r.evaluated.toLocaleString()} loadouts in ${((performance.now() - t) / 1000).toFixed(1)} s.`;
    }, 30);
  });
  const copier = (btnSel, fieldSel, noteSel, done) => {
    const cc = el.querySelector(btnSel); if (!cc) return;
    const field = el.querySelector(fieldSel); const note = el.querySelector(noteSel); const label = cc.textContent;
    field.addEventListener('focus', () => field.select());
    cc.addEventListener('click', async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(cc.dataset.code); ok = true; } catch { field.focus(); field.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } }
      note.textContent = ok ? done : 'Could not reach the clipboard: select the code and press Ctrl+C.';
      cc.textContent = ok ? 'Copied ✓' : label;
    });
  };
  copier('#copycode', '#codetext', '#copynote', 'Copied. In the MechLab choose Loadout → Import and paste.');
  copier('#copyskill', '#skilltext', '#skillnote', 'Copied. Open the Skills screen of this mech, choose Import and paste, then check the tree before applying.');
  if (pick) drawRangeChart(el.querySelector('#rangechart'), pick, rows.find((r) => r.stock));
  attachMechView(el, mech, pick);
}

function detailCard(r, frame, stockEv, rows) {
  const { ctx } = S; const ev = r.ev; const b = r.build;
  const bc = buildCode(ctx, frame, r);
  const where = bc.layout ? layoutSummary(ctx, bc.layout) : [];
  const sk = pickSkills(ctx, frame, b, ev, ui.role);
  const skCode = skillCode(ctx.db, sk.nodes);
  const skRows = skillSummary(ctx, frame, sk);
  const up = (id) => titleCase(ctx.upgrade.get(id)?.label ?? '');
  const byComp = {};
  ev.profiles.forEach((p, i) => { const c = ev.placement[i] ?? 'unplaced'; (byComp[c] ??= []).push(p); });
  const cmp = (v, s, d = 1, invert = false) => { if (!stockEv || r.stock) return ''; const diff = v - s; if (Math.abs(diff) < 0.05) return ''; const good = invert ? diff < 0 : diff > 0; return ` <span class="${good ? 'good' : 'bad'} small">${diff > 0 ? '+' : ''}${fmt(diff, d)}</span>`; };
  const sc = r.sc;
  return `<div class="card"><h3>${r.stock ? 'Stock loadout' : 'Selected build'} <span class="dim small">${esc(titleCase(r.title))}</span></h3>
    ${bc.code ? `<div class="bar codebar"><button id="copycode" class="primary" data-code="${esc(bc.code)}">Copy build code</button><input type="text" id="codetext" readonly value="${esc(bc.code)}" /><span class="dim small" id="copynote">Paste it in the MechLab: Loadout → Import, with this variant selected.</span></div>` : `<p class="dim small">No build code: ${esc(bc.problem)}.</p>`}
    <div class="kv">
      <div><span>Alpha damage</span><b>${fmt(ev.alpha, 1)}${cmp(ev.alpha, stockEv?.alpha)}</b></div>
      <div><span>Alpha heat</span><b>${fmt(ev.alphaHeat, 1)} / ${fmt(ev.capacity, 0)}</b></div>
      <div><span>Ghost heat</span><b class="${ev.ghost > 0 ? 'bad' : ''}">${fmt(ev.ghost, 1)}</b></div>
      <div><span>Max DPS</span><b>${fmt(ev.dps, 2)}${cmp(ev.dps, stockEv?.dps)}</b></div>
      <div><span>Sustained DPS</span><b>${fmt(ev.sustainedDps, 2)}${cmp(ev.sustainedDps, stockEv?.sustainedDps)}</b></div>
      <div><span>Cooling</span><b>${fmt(ev.dissipation, 2)}/s (${Math.round(ev.sustainFrac * 100)}%)</b></div>
      <div><span>Alphas to overheat</span><b>${fmt(ev.alphasToOverheat, 1)}</b></div>
      <div><span>Top speed</span><b>${fmt(ev.kph, 1)} kph${cmp(ev.kph, stockEv?.kph)}</b></div>
      <div><span>Armor + structure</span><b>${fmt(ev.ehp, 0)}${cmp(ev.ehp, stockEv?.ehp, 0)}</b></div>
      <div><span>Ammo lasts</span><b>${Number.isFinite(ev.ammoSeconds) ? fmt(ev.ammoSeconds, 0) + ' s' : 'n/a'}</b></div>
      <div><span>Weight</span><b class="${ev.freeTons < -0.01 ? 'bad' : ''}">${fmt(ev.tons, 1)} / ${frame.mech.tons}</b></div>
      <div><span>Spare slots</span><b class="${ev.slotsFree < 0 ? 'bad' : ''}">${ev.slotsFree}</b></div>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div><h2 style="margin-top:0">Loadout</h2>
        <div class="small">${esc(titleCase(b.engine.label))} · ${esc(up(b.structureType))} · ${esc(up(b.armorType))} (${Math.round(b.armorPct * 100)}% armor, ${fmt(ev.armorTons, 1)} t) · ${esc(up(b.heatSinkType))} × ${ev.totalSinks}${b.ecm ? ' · ECM' : ''}${b.artemis ? ' · Artemis IV' : ''}</div>
        <table style="margin-top:6px"><tbody>${COMPONENTS.filter((c) => byComp[c]).map((c) => `<tr><td class="dim">${COMP_LABEL[c]}</td><td>${byComp[c].map((p) => `<span class="tag ${p.type}">${esc(titleCase(p.label))}</span>`).join('')}</td></tr>`).join('')}
          ${ev.gear.placed.length ? `<tr><td class="dim">Team gear</td><td>${ev.gear.placed.map((g) => `<span class="tag">${esc(titleCase(ctx.item.get(g.id)?.label ?? g.id))} <span class="dim">${COMP_LABEL[g.c]}</span></span>`).join('')}</td></tr>` : ''}
          ${Object.entries(b.ammo ?? {}).length ? `<tr><td class="dim">Ammo</td><td>${Object.entries(b.ammo).map(([id, n]) => `<span class="tag">${n} t ${esc(titleCase(ctx.item.get(+id)?.label ?? id))}</span>`).join('')}</td></tr>` : ''}</tbody></table>
        ${ev.valid ? '' : `<p class="bad small">${ev.problems.map(esc).join('<br>')}</p>`}
        <h2>Skill tree <span class="dim small">${sk.total} / ${MAX_NODES} nodes for ${ROLE_LABEL[ui.role].toLowerCase()}</span></h2>
        ${skCode ? `<div class="bar codebar"><button id="copyskill" data-code="${esc(skCode)}">Copy skill tree code</button><input type="text" id="skilltext" readonly value="${esc(skCode)}" /></div><div class="dim small" id="skillnote" style="margin:-6px 0 8px">Paste it in the mech's Skills screen with Import, and check the tree before applying.</div>` : ''}
        <div>${skRows.map((x) => `<span class="tag" title="${esc(x.effect)}">${esc(x.label)} <b>${x.n}</b>/${x.of}${x.effect ? ` <span class="dim">${esc(x.effect)}</span>` : ''}</span>`).join('')}</div>
        ${where.length ? `<h2>Where it goes <span class="dim small">(what the build code contains)</span></h2><table><thead><tr><th>Location</th><th>Armor</th><th>Equipment</th></tr></thead><tbody>${where.map((w) => `<tr><td class="dim">${w.label}</td><td>${w.armor}</td><td class="small">${w.items.map((x) => esc(titleCase(x))).join(', ') || '<span class="dim">–</span>'}</td></tr>`).join('')}</tbody></table>` : ''}
        <h2>Why it scores ${fmt(sc.total, 1)}</h2>
        <div class="factors"><span>effective DPS <b>${fmt(sc.firepower, 2)}</b></span><span>× durability <b>${fmt(sc.durability, 2)}</b></span><span>× mobility <b>${fmt(sc.mobility, 2)}</b></span>
          <span>× alpha <b>${fmt(sc.alphaFactor, 2)}</b></span><span>× heat <b>${fmt(sc.heatFactor, 2)}</b></span><span>× ammo <b>${fmt(sc.ammoFactor, 2)}</b></span>${sc.gearFactor && sc.gearFactor !== 1 ? `<span>× team gear <b>${fmt(sc.gearFactor, 2)}</b></span>` : ''}</div>
        <p class="dim small">Effective DPS is damage landed on the aimed component over an 8 s burst and a 30 s fight at ${TUNING.roleRange[ui.role]} m, limited by heat. Spread, beam duration, missile behaviour and projectile travel time each reduce it.</p></div>
      <div><h2 style="margin-top:0">Damage by range <span class="dim small">(solid: this build · grey: stock)</span></h2><canvas class="chart" id="rangechart"></canvas>
        <table style="margin-top:8px"><thead><tr><th>Weapon</th><th class="num">Dmg</th><th class="num">DPS</th><th class="num">Heat/s</th><th class="num">Optimal</th><th class="num">Max</th></tr></thead><tbody>
        ${[...new Map(ev.profiles.map((p) => [p.id, p])).values()].map((p) => { const n = ev.profiles.filter((x) => x.id === p.id).length; return `<tr><td>${n}× ${esc(titleCase(p.label))}</td><td class="num">${fmt(p.alpha * n, 1)}</td><td class="num">${fmt(p.dps * n, 2)}</td><td class="num">${fmt(p.hps * n, 2)}</td><td class="num">${fmt(p.optimal, 0)}</td><td class="num">${fmt(p.max, 0)}</td></tr>`; }).join('')}</tbody></table></div>
    </div></div>`;
}

function drawRangeChart(cv, r, stock) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1; const w = cv.clientWidth; const h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const maxR = Math.max(600, ...r.ev.profiles.map((p) => p.max), ...(stock ? stock.ev.profiles.map((p) => p.max) : [])) * 1.02;
  const curve = (ev, eff) => { const pts = []; for (let d = 0; d <= maxR; d += maxR / 160) pts.push([d, ev.profiles.reduce((a, p) => a + p.dps * damageAt(p, d) * (eff ? precision(p, d) : 1), 0)]); return pts; };
  const main = curve(r.ev, false); const eff = curve(r.ev, true); const st = stock && !r.stock ? curve(stock.ev, false) : null;
  const maxY = Math.max(1, ...main.map((p) => p[1]), ...(st ? st.map((p) => p[1]) : [])) * 1.1;
  const X = (d) => 34 + (d / maxR) * (w - 44); const Y = (v) => h - 20 - (v / maxY) * (h - 30);
  g.font = '11px Segoe UI'; g.fillStyle = '#8b98a5'; g.strokeStyle = '#2a333d'; g.lineWidth = 1;
  for (let d = 0; d <= maxR; d += maxR > 1400 ? 400 : 200) { g.beginPath(); g.moveTo(X(d), 6); g.lineTo(X(d), h - 20); g.stroke(); g.fillText(`${d}m`, X(d) - 10, h - 6); }
  for (let i = 0; i <= 2; i++) { const v = (maxY / 1.1) * (i / 2); g.fillText(v.toFixed(0), 4, Y(v) + 4); }
  for (const [name, dist] of Object.entries(TUNING.roleRange)) { g.strokeStyle = name === ui.role ? '#f0a030' : '#3a4652'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(dist), 6); g.lineTo(X(dist), h - 20); g.stroke(); g.setLineDash([]); }
  const line = (pts, color, width, fill) => { g.beginPath(); pts.forEach(([d, v], i) => (i ? g.lineTo(X(d), Y(v)) : g.moveTo(X(d), Y(v)))); g.strokeStyle = color; g.lineWidth = width; g.stroke(); if (fill) { g.lineTo(X(maxR), Y(0)); g.lineTo(X(0), Y(0)); g.closePath(); g.fillStyle = fill; g.fill(); } };
  if (st) line(st, '#7a8794', 1.5);
  line(eff, '#4db6e8', 1.5, 'rgba(77,182,232,.12)');
  line(main, '#f0a030', 2);
  g.fillStyle = '#f0a030'; g.fillText('max DPS', w - 118, 16); g.fillStyle = '#4db6e8'; g.fillText('on-target', w - 62, 16);
}

async function attachMechView(el, mech, pick) {
  const canvas = el.querySelector('#mechcanvas'); const note = el.querySelector('#mv-note');
  mechView?.dispose(); mechView = null;
  try {
    const mod = await import('../mechview.js');
    const weapons = pick ? pick.ev.profiles.map((p, i) => ({ name: p.name, comp: pick.ev.placement[i] })) : [];
    mechView = await mod.createMechView(canvas, mech, weapons);
    if (!mechView) { note.textContent = '– model not exported yet (run npm run scan:mechs)'; return; }
    note.textContent = mechView.note ?? '';
    el.querySelectorAll('#mv-mode button').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('#mv-mode button').forEach((x) => x.classList.toggle('on', x === b)); mechView?.setMode(b.dataset.m);
    }));
  } catch (e) { note.textContent = '– 3D view unavailable'; console.warn(e); }
}
