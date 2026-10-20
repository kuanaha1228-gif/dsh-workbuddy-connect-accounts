/**
 * Prove a tree carries no account data, before anything is published.
 *
 * Two independent checks:
 *   1. every live secret value on this machine (tokens, nicknames, uids, the
 *      selected marker) is read from the archives and searched for verbatim;
 *   2. token fields holding a JWT literal, or an archive-shaped account array, are
 *      flagged even if they are not one of the values above.
 *
 *   node tools/scan-accounts.mjs .
 *
 * Exit 0 and "CLEAN" when the tree is safe to publish; 1 otherwise.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const TARGET = path.resolve(process.argv[2] ?? '.');
const DSH_HOME = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh');

const read = (file) => readFile(file, 'utf8').catch(() => undefined);

/** Every real secret this machine holds, so a leak is caught by its own value. */
async function liveSecrets() {
  const values = [];
  for (const entry of await readdir(DSH_HOME).catch(() => [])) {
    if (!/^\.workbuddy-accounts.*\.json$/u.test(entry)) continue;
    let doc;
    try {
      doc = JSON.parse(await read(path.join(DSH_HOME, entry)));
    } catch {
      continue;
    }
    for (const account of doc.accounts ?? []) {
      for (const field of ['accessToken', 'refreshToken', 'nickname', 'uid', 'enterpriseId']) {
        const value = account[field];
        if (typeof value === 'string' && value.length >= 4) values.push({ label: `${entry}:${field}`, value });
      }
    }
    if (typeof doc.selected === 'string' && doc.selected.length >= 4) {
      values.push({ label: `${entry}:selected`, value: doc.selected });
    }
  }
  const desktop = await read(path.join(DSH_HOME, 'workbuddy-desktop.info'));
  if (desktop !== undefined) {
    for (const m of desktop.matchAll(/"([A-Za-z0-9_-]{20,})"/gu)) values.push({ label: 'desktop.info', value: m[1] });
  }
  return values;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const secrets = await liveSecrets();
console.log(`live secrets collected: ${secrets.length} values`);
console.log(`scanning: ${TARGET}\n`);

const problems = [];
let scanned = 0;

for await (const file of walk(TARGET)) {
  const info = await stat(file);
  if (info.size > 4_000_000) continue;
  const text = await read(file);
  if (text === undefined) continue;
  scanned += 1;
  const relative = path.relative(TARGET, file);

  for (const { label, value } of secrets) {
    if (text.includes(value)) problems.push(`${relative}: contains ${label}`);
  }
  for (const m of text.matchAll(/(?:accessToken|refreshToken)\s*:\s*"([^"]{20,})"/gu)) {
    if (m[1].startsWith('eyJ')) problems.push(`${relative}: JWT literal in a token field`);
  }
  if (/"accounts"\s*:\s*\[/u.test(text) && /"nickname"\s*:/u.test(text)) {
    problems.push(`${relative}: archive-shaped account array`);
  }
}

console.log(`text files scanned: ${scanned}\n`);

if (problems.length === 0) {
  console.log('CLEAN — no account data found');
  process.exit(0);
}
console.log('PROBLEMS:');
for (const problem of [...new Set(problems)]) console.log(`  ${problem}`);
process.exit(1);
