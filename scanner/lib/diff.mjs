// Field-level diff between two stat snapshots, so a patch reads as
// "ClanERPPC  stats.heat  13.5 -> 14" rather than two big blobs.

const IGNORE = new Set(['key', 'version', 'scannedAt', 'skillNodes']);

function flatten(value, prefix, out) {
  if (value === null || typeof value !== 'object') { out.set(prefix, value); return out; }
  if (Array.isArray(value)) {
    // Quirk-style lists diff better keyed by name than by position.
    const named = value.length > 0 && value.every((v) => v && typeof v === 'object' && typeof v.name === 'string');
    const seen = new Map();
    value.forEach((v, i) => {
      let k = String(i);
      if (named) {
        const n = (seen.get(v.name) ?? 0);
        seen.set(v.name, n + 1);
        k = n ? `${v.name}#${n}` : v.name;
      }
      flatten(named && 'value' in v && Object.keys(v).length === 2 ? v.value : v, prefix ? `${prefix}.${k}` : k, out);
    });
    return out;
  }
  for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

export function diffDb(oldDb, newDb) {
  const changes = [];
  for (const cat of Object.keys(newDb)) {
    if (IGNORE.has(cat) || !Array.isArray(newDb[cat])) continue;
    const keyOf = (item, i) => item.id ?? item.name ?? (item.names ? item.names[0] : `${item.chassis}|${item.set}|${i}`);
    const oldMap = new Map((oldDb[cat] ?? []).map((x, i) => [keyOf(x, i), x]));
    const newMap = new Map(newDb[cat].map((x, i) => [keyOf(x, i), x]));
    for (const [id, item] of newMap) {
      const name = item.label || item.name || String(id);
      const before = oldMap.get(id);
      if (!before) { changes.push({ cat, id, name, kind: 'added' }); continue; }
      const a = flatten(before, '', new Map());
      const b = flatten(item, '', new Map());
      for (const [k, v] of b) {
        if (!a.has(k)) changes.push({ cat, id, name, kind: 'changed', field: k, from: null, to: v });
        else if (a.get(k) !== v) changes.push({ cat, id, name, kind: 'changed', field: k, from: a.get(k), to: v });
      }
      for (const [k, v] of a) if (!b.has(k)) changes.push({ cat, id, name, kind: 'changed', field: k, from: v, to: null });
    }
    for (const [id, item] of oldMap) if (!newMap.has(id)) changes.push({ cat, id, name: item.label || item.name || String(id), kind: 'removed' });
  }
  return changes;
}
