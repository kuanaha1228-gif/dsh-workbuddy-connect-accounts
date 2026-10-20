#!/usr/bin/env node
/**
 * Re-apply the two mechanical parts of this fork to a freshly rewritten build.
 *
 * The multi-account layer (vault, archive, routes, account list) has to be spliced
 * by hand whenever upstream restructures its bundle — that is a judgement call.
 * Two pieces do not: the composer-seat switcher and its styling are additive, and
 * their anchors are stable. This applies them in order and verifies the result.
 *
 *   node tools/reapply-ui.mjs --check   report what is missing, change nothing
 *   node tools/reapply-ui.mjs           apply
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/** Where the build to patch lives: the repo's own lib, or an installed copy. */
const LIB = process.env.WORKBUDDY_LIB_DIR ?? path.join(REPO, 'lib');
const CLIENT = path.join(LIB, 'client.js');

const text = await readFile(CLIENT, 'utf8');
console.log(`target : ${CLIENT}`);
console.log(`size   : ${text.length} bytes\n`);

/** The parts that must be present for this build to be the fork, not upstream. */
const REQUIRED = [
  ['seat switcher component', 'function SeatAccountSwitcher'],
  ['seat switcher in the row', 'SeatAccountSwitcher, { t }'],
  ['20px borderless trigger', 'height: 20'],
  ['transparent trigger', 'background: "transparent"'],
  ['account list', 'function AccountList'],
  ['switch action', 'switch-account'],
  ['formatTime hardened', 'Number.isNaN(date.getTime())'],
];

const missing = [];
for (const [label, marker] of REQUIRED) {
  const present = text.includes(marker);
  console.log(`  ${present ? 'ok  ' : 'MISS'} ${label}`);
  if (!present) missing.push(label);
}

// The switcher must not carry its own vertical nudge; the wrapper centres it.
const styleAt = text.indexOf('const seatSwitcherStyle = {');
if (styleAt >= 0) {
  const styleEnd = text.indexOf('\n\t\t};', styleAt);
  const odd = text.slice(styleAt, styleEnd).includes('translateY');
  console.log(`  ${odd ? 'MISS' : 'ok  '} switcher has no stray translateY`);
  if (odd) missing.push('switcher translateY');
}

console.log('');
if (missing.length === 0) {
  console.log('ALL UI PIECES PRESENT');
  process.exit(0);
}

console.log(`missing: ${missing.join(', ')}`);
if (CHECK) {
  console.log('\n(check only — nothing applied)');
  process.exit(10);
}

/**
 * Apply the scripts in order. Each is idempotent: it reports "already present"
 * rather than double-patching.
 */
const STEPS = [
  ['add-seat-switcher.mjs', 'composer seat switcher'],
  ['match-seat-style.mjs', 'seat switcher styling'],
  ['fix-seat-spacing.mjs', 'seat spacing corrections'],
];

for (const [script, label] of STEPS) {
  const file = path.join(REPO, 'tools', script);
  console.log(`\n--- ${label} (${script}) ---`);
  try {
    const out = execFileSync(process.execPath, [file], {
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, WORKBUDDY_LIB_DIR: LIB },
    });
    console.log(out.trim() || '(no output)');
  } catch (error) {
    console.error(`FAILED: ${script}`);
    console.error(String(error.stdout ?? '').trim());
    console.error(String(error.stderr ?? '').trim());
    process.exit(1);
  }
}

// Re-check after applying.
const after = await readFile(CLIENT, 'utf8');
const stillMissing = REQUIRED.filter(([, marker]) => !after.includes(marker)).map(([label]) => label);
if (stillMissing.length > 0) {
  console.error(`\nstill missing after applying: ${stillMissing.join(', ')}`);
  process.exit(1);
}
try {
  execFileSync(process.execPath, ['--check', CLIENT], { stdio: 'pipe' });
  console.log('\nUI pieces applied, syntax check: pass');
} catch (error) {
  console.error(`\nsyntax FAILED:\n${String(error.stderr ?? error.message)}`);
  process.exit(1);
}
