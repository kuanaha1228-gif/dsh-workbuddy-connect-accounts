/** Confirm the repo copy matches the installed build and carries every feature. */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALLED = path.join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-workbuddy-switchaccount', 'lib', 'client.js');
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js');

const a = (await readFile(INSTALLED, 'utf8')).replace(/\r\n/g, '\n');
const b = (await readFile(REPO, 'utf8')).replace(/\r\n/g, '\n');

console.log(`installed : ${a.length} bytes`);
console.log(`repo copy : ${b.length} bytes`);
console.log(`identical : ${a === b}\n`);

const CHECKS = [
  ['service switcher component', 'function SeatAccountSwitcher'],
  ['switcher rendered in seat', 'SeatAccountSwitcher, { t }'],
  ['account list', 'function AccountList'],
  ['switch action', 'switch-account'],
  ['remove action', 'remove-account'],
  ['formatTime hardened', 'Number.isNaN(date.getTime())'],
  ['20px trigger height', 'height: 20'],
  ['no trigger border', 'border: 0'],
  ['transparent trigger', 'background: "transparent"'],
  ['no stray translateY', 'transform: "translateY(2px)"'],
];
for (const [label, marker] of CHECKS) {
  console.log(`  ${a.includes(marker) ? 'yes' : 'NO '}  ${label}`);
}

// The last check must be absent, so report it inverted.
console.log(`\ntranslateY present (want no): ${a.includes('transform: "translateY(2px)"')}`);
console.log(`file mtime: ${(await stat(REPO)).mtime.toISOString()}`);
