// Minimal reader for CryEngine .pak archives (plain, unencrypted zip files).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export class Pak {
  constructor(file) {
    this.file = file;
    this.fd = fs.openSync(file, 'r');
    this.entries = new Map(); // lowercased forward-slash path -> entry
    this.#readDirectory();
  }

  #readDirectory() {
    const size = fs.fstatSync(this.fd).size;
    if (size < 22) return;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(this.fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`Not a zip archive: ${this.file}`);
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(this.fd, cd, 0, cdSize, cdOffset);
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cdSize; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const compSize = cd.readUInt32LE(p + 20);
      const rawSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      this.entries.set(name.toLowerCase(), { name, method, crc, compSize, rawSize, offset });
    }
  }

  has(name) { return this.entries.has(norm(name)); }

  list(filter) {
    const out = [];
    for (const e of this.entries.values()) if (!filter || filter(e.name.toLowerCase())) out.push(e);
    return out;
  }

  read(name) {
    const e = typeof name === 'string' ? this.entries.get(norm(name)) : name;
    if (!e) return null;
    const lh = Buffer.alloc(30);
    fs.readSync(this.fd, lh, 0, 30, e.offset);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`Bad local header for ${e.name} in ${this.file}`);
    const dataStart = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const comp = Buffer.alloc(e.compSize);
    fs.readSync(this.fd, comp, 0, e.compSize, dataStart);
    if (e.method === 0) return comp;
    if (e.method === 8) return zlib.inflateRawSync(comp);
    throw new Error(`Unsupported zip method ${e.method} for ${e.name}`);
  }

  text(name) {
    const b = this.read(name);
    if (!b) return null;
    return b.toString('utf8').replace(/^﻿/, '');
  }

  close() { fs.closeSync(this.fd); }
}

const norm = (n) => n.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

// A virtual file system over every pak in the game folder, like the engine sees it.
export class GameFS {
  constructor(gameDir) {
    this.gameDir = gameDir;       // .../MechWarrior Online/Game
    this.paks = [];
    this.index = new Map();       // path -> { pak, entry }
    const files = [];
    const walk = (dir) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) { if (d.name.toLowerCase() !== 'levels') walk(full); }
        else if (d.name.toLowerCase().endsWith('.pak')) files.push(full);
      }
    };
    walk(gameDir);
    for (const f of files.sort()) {
      let pak;
      try { pak = new Pak(f); } catch { continue; }
      this.paks.push(pak);
      for (const [k, entry] of pak.entries) this.index.set(k, { pak, entry });
    }
  }

  has(name) { return this.index.has(norm(name)); }
  read(name) { const h = this.index.get(norm(name)); return h ? h.pak.read(h.entry) : null; }
  text(name) { const b = this.read(name); return b ? b.toString('utf8').replace(/^﻿/, '') : null; }
  list(filter) {
    const out = [];
    for (const [k, h] of this.index) if (!filter || filter(k)) out.push(h.entry.name);
    return out;
  }
  stat(name) { const h = this.index.get(norm(name)); return h ? { pak: h.pak.file, ...h.entry } : null; }

  levelNames() {
    const dir = path.join(this.gameDir, 'Levels');
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'level.pak')))
      .map((d) => d.name);
  }
  levelPak(name) { return new Pak(path.join(this.gameDir, 'Levels', name, 'level.pak')); }
}
