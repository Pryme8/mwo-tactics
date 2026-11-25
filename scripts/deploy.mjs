// Builds the site and publishes web/dist (code + converted game data) to the gh-pages
// branch as a single commit, so the branch never accumulates old copies of the data.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web', 'dist');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx' });
const out = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

const data = path.join(root, 'web', 'public', 'data');
if (!fs.existsSync(path.join(data, 'index.json'))) throw new Error('No scanned data. Run `npm run update` and `npm run scan:mechs` first.');
if (!fs.existsSync(path.join(data, 'mechs'))) console.warn('Warning: no mech models exported (npm run scan:mechs); the hosted site cannot export them on demand.');

run('npx', ['vite', 'build', 'web']);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

// GitHub Pages limits: 100 MB per file, about 1 GB per site.
let total = 0; let biggest = ['', 0];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else { const s = fs.statSync(p).size; total += s; if (s > biggest[1]) biggest = [p, s]; }
  }
})(dist);
const mb = (n) => (n / 1048576).toFixed(0);
console.log(`Site: ${mb(total)} MB, largest file ${mb(biggest[1])} MB`);
if (biggest[1] > 100 * 1048576) throw new Error(`${biggest[0]} is over GitHub's 100 MB file limit`);
if (total > 1000 * 1048576) throw new Error('Site is over the 1 GB GitHub Pages limit');

const remote = out('git', ['remote', 'get-url', 'origin']);
const rev = out('git', ['rev-parse', '--short', 'HEAD']);
fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });
run('git', ['init', '-q', '-b', 'gh-pages'], dist);
run('git', ['add', '-A'], dist);
run('git', ['commit', '-q', '-m', `Deploy ${rev}`], dist);
run('git', ['push', '-f', remote, 'gh-pages'], dist);
fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });
console.log('Published to the gh-pages branch.');
