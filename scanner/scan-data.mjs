// Reads every stat the game ships (weapons, equipment, mechs, quirks, omnipods, skill
// tree) out of the installed .pak files and writes a snapshot for the current build.
// Running it again after a patch writes a new snapshot plus a change list.
import path from 'node:path';
import crypto from 'node:crypto';
import { GameFS, Pak } from './lib/pak.mjs';
import { parseXml, kids, kid, find, attr, num, attrsTyped } from './lib/xml.mjs';
import { findInstall, buildInfo, writeJson, readJson, DATA_DIR } from './lib/game.mjs';
import { diffDb } from './lib/diff.mjs';

const HARDPOINT_TYPES = { 0: 'Ballistic', 1: 'Energy', 2: 'Missile', 3: 'ECM', 4: 'AMS' };

const install = findInstall();
const info = buildInfo(install);
console.log(`MWO install: ${install}\nBuild: ${info.version}`);

const t0 = Date.now();
const gfs = new GameFS(path.join(install, 'Game'));
console.log(`Indexed ${gfs.paks.length} paks, ${gfs.index.size} files (${Date.now() - t0} ms)`);

// ---------- localisation ----------
function loadLoc() {
  const loc = new Map();
  const pak = new Pak(path.join(install, 'Game', 'Localized', 'English_xml.pak'));
  for (const e of pak.list((n) => n.endsWith('.xml'))) {
    const text = pak.text(e.name);
    const rowRe = /<Row[^>]*>([\s\S]*?)<\/Row>/g;
    const cellRe = /<Data[^>]*>([\s\S]*?)<\/Data>/g;
    let r;
    while ((r = rowRe.exec(text))) {
      cellRe.lastIndex = 0;
      const k = cellRe.exec(r[1]);
      const v = cellRe.exec(r[1]);
      if (k && v) {
        const key = k[1].trim().toLowerCase();
        const val = v[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, '\n');
        if (key && val && !loc.has(key)) loc.set(key, val);
      }
    }
  }
  pak.close();
  return loc;
}
const loc = loadLoc();
const L = (tag, dflt) => {
  if (!tag) return dflt;
  return loc.get(tag.replace(/^@/, '').toLowerCase()) ?? dflt;
};
console.log(`Localisation strings: ${loc.size}`);

const xml = (p) => {
  const t = gfs.text(p);
  if (t == null) { console.warn(`  missing: ${p}`); return { tag: '#root', a: {}, c: [] }; }
  return parseXml(t);
};
const factions = (node) => (attr(node, 'faction', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const label = (node, dflt) => L(attr(kid(node, 'Loc'), 'nameTag'), dflt);
const lcFirst = (s) => s[0].toLowerCase() + s.slice(1);

// ---------- weapons ----------
function scanWeapons() {
  const out = [];
  for (const w of find(xml('Libs/Items/Weapons/Weapons.xml'), 'Weapon')) {
    const stats = attrsTyped(kid(w, 'WeaponStats'));
    if (!('damage' in stats) && !('slots' in stats)) continue;
    const ranges = kids(kid(w, 'Ranges'), 'Range').map((r) => ({
      start: num(r, 'start'), mod: num(r, 'damageModifier'),
      interp: attr(r, 'interpolationToNextRange', 'linear'), exp: num(r, 'exponent', 1),
    }));
    const art = kid(w, 'Artemis');
    out.push({
      id: +attr(w, 'id'), name: attr(w, 'name'), label: label(w, attr(w, 'name')),
      faction: factions(w), cType: attr(w, 'CType', ''),
      aliases: (attr(w, 'HardpointAliases', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
      type: stats.type || '', stats, ranges,
      artemisRestrictedTo: art ? +attr(art, 'RestrictedTo', 0) : 0,
    });
  }
  return out;
}

// ---------- generic modules ----------
const SKIP = new Set(['ModuleStats', 'Loc', 'EffectList', 'Audio']);
const subtree = (n) => (n.c.length ? { ...attrsTyped(n), children: n.c.map((x) => ({ tag: x.tag, ...subtree(x) })) } : attrsTyped(n));

function scanModules(file, tag = 'Module') {
  const out = [];
  for (const m of find(xml(file), tag)) {
    const ms = kid(m, 'ModuleStats');
    const item = {
      id: +attr(m, 'id'), name: attr(m, 'name'), label: label(m, attr(m, 'name')),
      cType: attr(m, 'CType', ''), faction: factions(m),
      slots: num(ms, 'slots'), tons: num(ms, 'tons'), health: num(ms, 'health'),
    };
    const allowed = attr(ms, 'amountAllowed');
    if (allowed !== undefined) item.amountAllowed = +allowed;
    const comps = attr(ms, 'components');
    if (comps) item.components = comps.split(',').map((s) => s.trim());
    if (attr(ms, 'TonsMin') !== undefined) { item.tonsMin = num(ms, 'TonsMin'); item.tonsMax = num(ms, 'TonsMax'); }
    for (const c of m.c) if (!SKIP.has(c.tag)) item[lcFirst(c.tag)] = subtree(c);
    out.push(item);
  }
  return out;
}

function scanEngines() {
  return scanModules('Libs/Items/Modules/Engines.xml').filter((e) => e.engineStats).map((e) => {
    const s = e.engineStats;
    return {
      id: e.id, name: e.name, label: e.label, faction: e.faction,
      kind: e.name.replace(/^Engine_/, '').replace(/_?\d+$/, ''),
      rating: s.rating, tons: s.weight, slots: s.slots, sideSlots: s.sideSlots || 0,
      sidesToDie: s.sidesToDie || 0, heatsinks: s.heatsinks, health: s.health,
      movementHeatMultiplier: s.movementHeatMultiplier ?? 1,
    };
  });
}

function scanUpgrades() {
  const out = [];
  for (const u of find(xml('Libs/Items/UpgradeTypes/UpgradeTypes.xml'), 'UpgradeType')) {
    const item = { id: +attr(u, 'id'), name: attr(u, 'name'), label: label(u, attr(u, 'name')), cType: attr(u, 'CType'), faction: factions(u) };
    for (const c of u.c) if (c.tag !== 'Loc') item[lcFirst(c.tag)] = attrsTyped(c);
    out.push(item);
  }
  return out;
}

// ---------- mechs ----------
const quirksOf = (node) => kids(node, 'Quirk').map((q) => ({ name: attr(q, 'name'), value: num(q, 'value') }));

// <chassis>-hardpoints.xml: one <WeaponSlot> per physical mount on that hardpoint id.
function hardpointCounts(chassis) {
  const counts = new Map();
  const file = `Objects/mechs/${chassis}/${chassis}-hardpoints.xml`;
  if (!gfs.has(file)) return counts;
  for (const h of find(xml(file), 'Hardpoint')) {
    const slots = kids(h, 'WeaponSlot');
    counts.set(+attr(h, 'id'), { count: Math.max(1, slots.length) });
  }
  return counts;
}

function parseHardpoints(node, hpCounts) {
  return kids(node, 'Hardpoint').map((h) => {
    const id = +attr(h, 'ID');
    return { id, type: HARDPOINT_TYPES[+attr(h, 'Type')] ?? `Type${attr(h, 'Type')}`, count: hpCounts.get(id)?.count ?? 1 };
  });
}

function scanOmnipods(chassisList) {
  const ids = new Map();
  for (const o of find(xml('Libs/Items/OmniPods.xml'), 'OmniPod')) ids.set(`${attr(o, 'set')}|${attr(o, 'component')}`, +attr(o, 'id'));
  const pods = [];
  const setBonuses = [];
  for (const chassis of chassisList) {
    const file = `Objects/mechs/${chassis}/${chassis}-omnipods.xml`;
    if (!gfs.has(file)) continue;
    const hpCounts = hardpointCounts(chassis);
    for (const set of find(xml(file), 'Set')) {
      const setName = attr(set, 'name');
      for (const b of find(kid(set, 'SetBonuses'), 'Bonus')) setBonuses.push({ chassis, set: setName, pieces: num(b, 'PieceCount'), quirks: quirksOf(b) });
      for (const c of kids(set, 'component')) {
        const comp = attr(c, 'name');
        pods.push({
          id: ids.get(`${setName}|${comp}`) ?? 0, chassis, set: setName, component: comp,
          hardpoints: parseHardpoints(c, hpCounts), quirks: quirksOf(c),
          internals: kids(c, 'Internal').map((i) => ({ id: +attr(i, 'ItemID'), toggleable: attr(i, 'Toggleable') === '1' })),
          fixed: kids(c, 'Fixed').map((i) => +attr(i, 'ItemID')),
          canEquipECM: attr(c, 'CanEquipECM') === '1',
          maxJumpJets: num(c, 'MaxJumpJets', 0),
        });
      }
    }
  }
  return { pods, setBonuses };
}

function scanLoadout(name) {
  const file = `Libs/MechLoadout/${name}.xml`;
  if (!gfs.has(file)) return null;
  const root = kid(xml(file), 'Loadout');
  if (!root) return null;
  const up = kid(root, 'Upgrades');
  const out = {
    armorType: +attr(kid(up, 'Armor'), 'ItemID', 0), structureType: +attr(kid(up, 'Structure'), 'ItemID', 0),
    heatSinkType: +attr(kid(up, 'HeatSinks'), 'ItemID', 0), artemis: attr(kid(up, 'Artemis'), 'Equipped') === '1',
    components: {},
  };
  for (const c of kids(kid(root, 'ComponentList'), 'component')) {
    const entry = { armor: num(c, 'Armor'), items: c.c.filter((i) => attr(i, 'ItemID')).map((i) => +attr(i, 'ItemID')) };
    if (attr(c, 'OmniPod')) entry.omniPod = +attr(c, 'OmniPod');
    out.components[attr(c, 'Name')] = entry;
  }
  return out;
}

function scanMechs() {
  const mechs = [];
  const hpCache = new Map();
  for (const m of find(xml('Libs/Items/Mechs/Mechs.xml'), 'Mech')) {
    const name = attr(m, 'name');
    const chassis = attr(m, 'chassis');
    const file = `Objects/mechs/${chassis}/${name}.mdf`;
    if (!gfs.has(file)) continue;
    const def = kid(xml(file), 'MechDefinition');
    const mech = kid(def, 'Mech');
    if (!mech) continue;
    if (!hpCache.has(chassis)) hpCache.set(chassis, hardpointCounts(chassis));
    const hpCounts = hpCache.get(chassis);
    const tons = num(mech, 'MaxTons');
    const components = {};
    let omni = false;
    for (const c of kids(kid(def, 'ComponentList'), 'Component')) {
      const comp = {
        slots: num(c, 'Slots'), hp: num(c, 'HP'),
        internals: kids(c, 'Internal').map((i) => +attr(i, 'ItemID')),
        fixed: kids(c, 'Fixed').map((i) => +attr(i, 'ItemID')),
        hardpoints: parseHardpoints(c, hpCounts),
        pieces: find(c, 'Attachment').map((a) => attr(a, 'AName')).filter(Boolean),
      };
      if (attr(c, 'OmniSlot') === '1') { omni = true; comp.omniSlot = true; }
      if (attr(c, 'OmniPod')) comp.omniPod = +attr(c, 'OmniPod');
      if (attr(c, 'CanEquipECM') === '1') comp.canEquipECM = true;
      components[attr(c, 'Name')] = comp;
    }
    const variant = attr(mech, 'Variant', name.toUpperCase());
    mechs.push({
      id: +attr(m, 'id'), name, variant,
      label: L(name, variant), chassis, chassisLabel: L(chassis, chassis),
      faction: attr(m, 'faction'), tons,
      weightClass: tons <= 35 ? 'Light' : tons <= 55 ? 'Medium' : tons <= 75 ? 'Heavy' : 'Assault',
      omni, maxJumpJets: num(mech, 'MaxJumpJets'), canEquipECM: attr(mech, 'CanEquipECM') === '1',
      minEngine: num(mech, 'MinEngineRating'), maxEngine: num(mech, 'MaxEngineRating'),
      consumableSlots: num(kid(def, 'Cockpit'), 'ConsumableSlots'),
      components, quirks: quirksOf(kid(def, 'QuirkList')),
      movement: attrsTyped(kid(def, 'MovementTuningConfiguration')),
      stock: scanLoadout(name),
    });
  }
  return mechs;
}

function scanSkills() {
  const out = [];
  for (const n of find(xml('Libs/MechPilotTalents/MechSkillTreeNodes.xml'), 'Node')) {
    const names = (attr(n, 'names', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const effects = kids(n, 'Effect').map((e) => {
      const byFaction = {};
      for (const f of kids(e, 'Faction')) {
        const entry = { value: num(f, 'value') };
        const classes = kids(f, 'WeightClass');
        if (classes.length) {
          entry.byClass = {};
          for (const wc of classes) {
            entry.byClass[attr(wc, 'name')] = { value: num(wc, 'value'), byTons: Object.fromEntries(kids(wc, 'Tonnage').map((t) => [attr(t, 'name'), num(t, 'value')])) };
          }
        }
        byFaction[attr(f, 'name')] = entry;
      }
      return { name: attr(e, 'name'), value: num(e, 'value'), byFaction };
    });
    const affects = kid(n, 'Affects');
    out.push({ names, count: names.length, affects: affects ? attrsTyped(affects) : null, effects });
  }
  return out;
}

// ---------- assemble ----------
const weapons = scanWeapons();
const ammo = scanModules('Libs/Items/Modules/Ammo.xml').map((a) => ({
  id: a.id, name: a.name, label: a.label, faction: a.faction, slots: a.slots, tons: a.tons,
  type: a.ammoTypeStats?.type ?? '', numShots: a.ammoTypeStats?.numShots ?? 0, internalDamage: a.ammoTypeStats?.internalDamage ?? 0,
}));
const engines = scanEngines();
const equipment = scanModules('Libs/Items/Modules/Equipment.xml');
const jumpjets = scanModules('Libs/Items/Modules/JumpJets.xml');
const masc = scanModules('Libs/Items/Modules/MASC.xml');
const internals = scanModules('Libs/Items/Modules/Internals.xml', 'Internal');
const upgrades = scanUpgrades();
const mechs = scanMechs();
const { pods: omnipods, setBonuses } = scanOmnipods([...new Set(mechs.map((m) => m.chassis))]);
const skills = scanSkills();

const db = { weapons, ammo, engines, equipment, jumpjets, masc, internals, upgrades, mechs, omnipods, setBonuses, skills };
for (const [k, v] of Object.entries(db)) console.log(`  ${k.padEnd(12)} ${v.length}`);

// ---------- self-check: stock loadouts should weigh in at (or just under) max tonnage ----------
{
  const byId = new Map();
  for (const list of [weapons, ammo, engines, equipment, jumpjets, masc, internals]) for (const i of list) byId.set(i.id, i);
  const up = new Map(upgrades.map((u) => [u.id, u]));
  let ok = 0; let checked = 0; const off = [];
  for (const m of mechs) {
    if (!m.stock || !m.stock.armorType) continue;
    const s = m.stock;
    let t = m.tons * (up.get(s.structureType)?.structureTypeStats?.weightPerTon ?? 0.1);
    t = Math.ceil(t * 2 - 1e-9) / 2;
    let armor = 0; let unknown = 0;
    const artemisTons = up.get(3050)?.artemisTypeStats?.extraTons ?? 1;
    for (const [cn, c] of Object.entries(s.components)) {
      armor += c.armor;
      for (const id of [...c.items, ...(m.components[cn]?.fixed ?? [])]) {
        const it = byId.get(id);
        if (!it) { unknown++; continue; }
        t += it.tons ?? it.stats?.tons ?? 0;
        if (s.artemis && it.stats?.artemisAmmoType) t += artemisTons;
      }
    }
    t += armor / (up.get(s.armorType)?.armorTypeStats?.armorPerTon ?? 32);
    checked++;
    if (!unknown && t <= m.tons + 0.01 && t >= m.tons - 1.0) ok++;
    else if (off.length < 8) off.push(`${m.name}: ${t.toFixed(2)}/${m.tons}${unknown ? ` (${unknown} unknown items)` : ''}`);
  }
  console.log(`Stock-loadout weight check: ${ok}/${checked} within 1t of max${off.length ? `\n  e.g. ${off.join('\n       ')}` : ''}`);
}

// ---------- snapshot + diff ----------
const hash = crypto.createHash('sha1').update(JSON.stringify(db)).digest('hex').slice(0, 10);
const index = readJson(path.join(DATA_DIR, 'index.json'), { patches: [], latest: null });
const prev = index.patches.find((p) => p.key === index.latest);
const now = new Date().toISOString();

if (prev && prev.hash === hash) {
  prev.lastSeen = now;
  writeJson(path.join(DATA_DIR, 'index.json'), index, true);
  console.log(`No stat changes since snapshot ${prev.key}.`);
} else {
  let key = info.version;
  if (index.patches.some((p) => p.key === key)) key = `${info.version}+${now.slice(0, 10)}`;
  if (index.patches.some((p) => p.key === key)) key = `${info.version}+${hash}`;
  const entry = { key, version: info.version, hash, scannedAt: now, lastSeen: now, gameDataModified: info.gameDataModified, previous: prev?.key ?? null, changeCount: 0 };
  writeJson(path.join(DATA_DIR, 'patches', key, 'db.json'), { key, version: info.version, scannedAt: now, ...db });
  if (prev) {
    const old = readJson(path.join(DATA_DIR, 'patches', prev.key, 'db.json'));
    if (old) {
      const changes = diffDb(old, db);
      entry.changeCount = changes.length;
      writeJson(path.join(DATA_DIR, 'patches', key, 'changes.json'), { from: prev.key, to: key, changes });
      console.log(`${changes.length} changes since ${prev.key}`);
    }
  }
  index.patches.push(entry);
  index.latest = key;
  writeJson(path.join(DATA_DIR, 'index.json'), index, true);
  console.log(`Wrote snapshot ${key} (${hash})`);
}
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
