// Reading, naming and ranking mech quirks (the bonuses each variant gets on top of the base stats).
import { mechFrame, quirkTable, weaponProfile, weaponScopes, COMPONENTS } from './buildmath.js';

export const CATS = [['weapon', 'Weapons'], ['armor', 'Armor & structure'], ['mobility', 'Mobility'], ['heat', 'Heat'], ['other', 'Sensors & gear'], ['ammo', 'Extra ammo']];

const WSTAT = {
  cooldown: 'cooldown', heat: 'heat', range: 'range', velocity: 'velocity', duration: 'burn time', spread: 'spread', jamchance: 'jam chance',
  jamduration: 'jam time', jamrampdownduration: 'jam ramp-down', rof: 'rate of fire', minheatpenaltylevel: 'ghost heat limit', critdamage: 'crit damage',
  critchance: 'crit chance', narcduration: 'NARC duration', damage: 'damage',
};
const LOC = { ct: 'centre torso', ctr: 'rear centre torso', hd: 'head', la: 'left arm', ra: 'right arm', ll: 'left leg', rl: 'right leg', lt: 'left torso', rt: 'right torso', ltr: 'rear left torso', rtr: 'rear right torso', all: 'every location' };
const PLAIN = {
  mechtopspeed: ['mobility', 'Top speed'], mechacceleration: ['mobility', 'Acceleration'], mechdeceleration: ['mobility', 'Deceleration'], turnrate: ['mobility', 'Turn rate'],
  reversespeed: ['mobility', 'Reverse speed'], speedretention: ['mobility', 'Speed kept when legged'], hillclimb: ['mobility', 'Slowdown on slopes'], accellerp_all: ['mobility', 'Acceleration'],
  decellerp_all: ['mobility', 'Deceleration'], turnlerp_all: ['mobility', 'Turn rate'], jumpjets_burntime: ['mobility', 'Jump jet burn time'], jumpjets_initialthrust: ['mobility', 'Jump jet initial thrust'],
  jumpjets_heat: ['mobility', 'Jump jet heat'], jumpjetslots: ['mobility', 'Extra jump jets'], falldamage: ['mobility', 'Fall damage'],
  torso_yawangle: ['mobility', 'Torso twist range'], torso_yawspeed: ['mobility', 'Torso twist speed'], torso_pitchangle: ['mobility', 'Torso pitch range'], torso_pitchspeed: ['mobility', 'Torso pitch speed'],
  heatdissipation: ['heat', 'Heat dissipation'], maxheat: ['heat', 'Heat capacity'], externalheat: ['heat', 'Heat from outside sources'], overheatdamage: ['heat', 'Overheat damage'],
  coolshotcapacity: ['heat', 'Extra cool shots'], coolshotcooldown: ['heat', 'Cool shot cooldown'],
  increasedarmor: ['armor', 'Armor (whole mech)'], increasedstructure: ['armor', 'Structure (whole mech)'], critchance_receiving: ['armor', 'Critical hits taken'], screenshake: ['armor', 'Screen shake when hit'],
  sensorrange: ['other', 'Sensor range'], seismicsensorrange: ['other', 'Seismic sensor range'], targetdecayduration: ['other', 'Target decay time'], targetinfogathering: ['other', 'Target info speed'],
  radardeprivation: ['other', 'Radar deprivation'], backfacetargetretentionrange: ['other', 'Rear target retention range'], ecmtargetrangereduction: ['other', 'ECM detection range cut'],
  stealtharmorcooldown: ['other', 'Stealth armor cooldown'], advancedzoom: ['other', 'Advanced zoom'], captureaccelerator: ['other', 'Capture speed'], extraconsumableslot: ['other', 'Extra consumable slots'],
  uavcapacity: ['other', 'Extra UAVs'], uavduration: ['other', 'UAV duration'], uavrange: ['other', 'UAV range'], strategicstrikecapacity: ['other', 'Extra strikes'], startupduration: ['other', 'Startup time'],
  gaussextendedcharge: ['weapon', 'Gauss charge hold time'],
};

// "isultraautocannon5" -> "IS Ultra AC/5"
const WORDS = ['antimissilesystem', 'autocannon', 'machinegun', 'snubnose', 'standard', 'ballistic', 'launcher', 'missile', 'medium', 'family', 'rocket', 'beacon', 'energy', 'streak', 'rotary', 'flamer', 'large', 'small', 'heavy', 'light', 'pulse', 'laser', 'ultra', 'gauss', 'rifle', 'clan', 'narc', 'non', 'std', 'lsr', 'lbx', 'ppc', 'srm', 'lrm', 'mrm', 'atm', 'tag', 'all', 'er', 'is'];
const SHOW = { is: 'IS', clan: 'Clan', er: 'ER', lsr: 'laser', lbx: 'LB-X', autocannon: 'AC', ppc: 'PPC', srm: 'SRM', lrm: 'LRM', mrm: 'MRM', atm: 'ATM', tag: 'TAG', narc: 'NARC', antimissilesystem: 'AMS', std: 'standard', non: 'non-', family: '(all kinds)', machinegun: 'machine gun', snubnose: 'snub-nose', all: 'All weapons', rifle: 'rifle', beacon: '' };
export function scopeLabel(scope) {
  let s = scope.toLowerCase(); const out = [];
  while (s) {
    const num = s.match(/^\d+/);
    if (num) { out.push((out[out.length - 1] === 'AC' ? '/' : ' ') + num[0]); s = s.slice(num[0].length); continue; }
    const w = WORDS.find((x) => s.startsWith(x) && (x !== 'is' || out.length === 0));
    if (!w) { out.push(' ' + s); break; }
    out.push(' ' + (SHOW[w] ?? w)); s = s.slice(w.length);
  }
  const t = out.join('').replace(/\s+/g, ' ').replace(/non- /, 'non-').replace(/ \/ ?/g, '/').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const parsed = new Map();
export function parseQuirk(name) {
  if (parsed.has(name)) return parsed.get(name);
  const kind = /_additive$/.test(name) ? 'additive' : 'multiplier';
  const body = name.replace(/_(multiplier|additive)$/, '');
  let cat = 'other'; let label = body.replace(/_/g, ' '); let scope = null; let stat = null;
  let m;
  if (PLAIN[body]) [cat, label] = PLAIN[body];
  else if ((m = body.match(/^ammocapacity_(.+)$/))) { cat = 'ammo'; label = 'Extra ammo: ' + m[1].replace(/_/g, ' ').toUpperCase(); }
  else if ((m = body.match(/^(armorresist|internalresist)_(\w+)$/))) { cat = 'armor'; label = (m[1] === 'armorresist' ? 'Armor: ' : 'Structure: ') + (LOC[m[2]] ?? m[2]); }
  else if ((m = body.match(/^(.+)_([a-z]+)$/)) && WSTAT[m[2]]) { cat = 'weapon'; scope = m[1].toLowerCase(); stat = m[2]; label = `${scopeLabel(scope)} ${WSTAT[stat]}`; }
  const lowerBetter = /cooldown|heat(?!dissipation)|spread|duration|jamchance|receiving|falldamage|screenshake|overheatdamage|hillclimb/.test(body) && !/minheatpenalty|maxheat|narcduration|uavduration|targetdecay/.test(body);
  const q = { name, kind, body, cat, label, scope, stat, lowerBetter, hidden: /xpbonus|cbillbonus/.test(name) };
  parsed.set(name, q);
  return q;
}

export function valueText(q, v) {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  return q.kind === 'multiplier' ? `${sign}${(a * 100).toFixed(1).replace(/\.0$/, '')}%` : `${sign}${+a.toFixed(2)}`;
}
export const isGood = (q, v) => (q.lowerBetter ? v < 0 : v > 0);
// bigger = better for the pilot, whatever the sign convention of the stat
export const goodness = (q, v) => (q.lowerBetter ? -v : v);

// One entry per distinct variant: its summed quirks and hardpoint counts. Built once.
export function quirkIndex(S) {
  if (S._qi) return S._qi;
  const rows = []; const byName = new Map();
  for (const mech of S.db.mechs) {
    const e = S.builds?.mechs[mech.id];
    if (e?.sameAs && e.sameAs !== mech.id) continue;        // hero / special copies with identical stats
    const frame = mechFrame(S.ctx, mech);
    const qt = quirkTable(frame.quirks);
    const hp = { Ballistic: 0, Energy: 0, Missile: 0 };
    for (const c of COMPONENTS) for (const t in hp) hp[t] += frame.comps[c]?.hardpoints[t] ?? 0;
    const armor = [...qt].filter(([n]) => /^armorresist_(?!all)/.test(n)).reduce((a, [, v]) => a + v, 0);
    const struct = [...qt].filter(([n]) => /^internalresist_(?!all)/.test(n)).reduce((a, [, v]) => a + v, 0);
    if (armor) qt.set('total_armorbonus_additive', armor);
    if (struct) qt.set('total_structurebonus_additive', struct);
    const row = { mech, qt, hp, tier: e?.bestTier ?? null };
    rows.push(row);
    for (const [name, v] of qt) { if (!v) continue; if (!byName.has(name)) byName.set(name, []); byName.get(name).push({ row, v }); }
  }
  parsed.set('total_armorbonus_additive', { name: 'total_armorbonus_additive', kind: 'additive', cat: 'armor', label: 'Armor: total of all locations', lowerBetter: false });
  parsed.set('total_structurebonus_additive', { name: 'total_structurebonus_additive', kind: 'additive', cat: 'armor', label: 'Structure: total of all locations', lowerBetter: false });
  const quirks = [];
  for (const [name, list] of byName) {
    const q = parseQuirk(name); if (q.hidden) continue;
    list.sort((a, b) => goodness(q, b.v) - goodness(q, a.v));
    quirks.push({ q, list, best: list[0].v });
  }
  quirks.sort((a, b) => /^total_/.test(b.q.name) - /^total_/.test(a.q.name) || b.list.length - a.list.length);
  S._qi = { rows, byName, quirks };
  return S._qi;
}

// Where a value stands among every mech that has the quirk.
export function standing(qi, name, v) {
  const list = qi.byName.get(name); if (!list) return null;
  const q = parseQuirk(name);
  const g = goodness(q, v);
  return { rank: 1 + list.filter((x) => goodness(q, x.v) > g + 1e-9).length, of: list.length, best: list[0].v };
}

export const WEAPON_STATS = [['dps', 'Damage per second'], ['cooldown', 'Cooldown'], ['heat', 'Heat'], ['range', 'Range'], ['velocity', 'Velocity'], ['duration', 'Burn time'], ['spread', 'Spread'], ['jamchance', 'Jam chance'], ['rof', 'Rate of fire'], ['minheatpenaltylevel', 'Ghost heat limit']];

// Every mech that can mount the weapon, with all the quirks that apply to it added up.
export function weaponBoard(S, w, stat) {
  const qi = quirkIndex(S);
  const scopes = weaponScopes(w);
  const kind = stat === 'minheatpenaltylevel' ? 'additive' : 'multiplier';
  const base = weaponProfile(w);
  const q = { kind, lowerBetter: ['cooldown', 'heat', 'duration', 'spread', 'jamchance'].includes(stat) };
  const out = [];
  for (const row of qi.rows) {
    if (!row.hp[w.type] || !w.faction.includes(row.mech.faction)) continue;
    const p = weaponProfile(w, row.qt);
    let v; let parts = [];
    if (stat === 'dps') {
      v = base.dps > 0 ? p.dps / base.dps - 1 : 0;
      for (const st of ['cooldown', 'duration', 'rof', 'jamchance']) for (const s of scopes) { const x = row.qt.get(`${s}_${st}_multiplier`); if (x) parts.push({ label: `${scopeLabel(s)} ${WSTAT[st]}`, text: valueText({ kind: 'multiplier' }, x) }); }
    } else {
      v = 0;
      for (const s of scopes) { const x = row.qt.get(`${s}_${stat}_${kind}`); if (x) { v += x; parts.push({ label: scopeLabel(s), text: valueText(q, x) }); } }
    }
    if (Math.abs(v) < 1e-9) continue;
    out.push({ row, v, parts, p });
  }
  out.sort((a, b) => goodness(q, b.v) - goodness(q, a.v));
  return { q, base, list: out };
}
