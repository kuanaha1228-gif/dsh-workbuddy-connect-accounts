#!/usr/bin/env node
/**
 * Publish a build the user has confirmed works.
 *
 * Deliberately a separate, manual command. Every defect this project has had was
 * found by installing the build and looking at it — a card that rendered raw keys,
 * a panel that vanished when expanded, a switcher that read as a foreign box. The
 * automated checks catch structure; they cannot catch "this looks wrong".
 *
 * It refuses to publish unless:
 *   - every js file parses
 *   - the manifest's entry point exists
 *   - the seat switcher and account list are still present
 *   - the account-data scan prints CLEAN
 *
 *   node automation/publish-release.mjs 0.7.10
 *   node automation/publish-release.mjs --dry-run
 */
import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const DRY_RUN = process.argv.includes('--dry-run');

const say = (m = '') => process.stdout.write(`${m}\n`);
const refuse = (message) => {
  say('');
  say(`  x ${message}`);
  process.exit(1);
};

const pkgPath = path.join(REPO, 'package.json');
const pkgBefore = JSON.parse((await readFile(pkgPath, 'utf8')).replace(/^\uFEFF/u, ''));
const VERSION = process.argv[2] !== undefined && /^\d+\.\d+\.\d+$/u.test(process.argv[2])
  ? process.argv[2]
  : pkgBefore.version;
const previousVersion = pkgBefore.version;

say(`publishing ${VERSION}`);
say(`from       ${REPO}`);

// --- 1. every file must parse ------------------------------------------------
const LIB = path.join(REPO, 'lib');
const jsFiles = (await readdir(LIB)).filter((name) => name.endsWith('.js'));
if (jsFiles.length === 0) refuse('lib/ has no js files');
for (const name of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', path.join(LIB, name)], { stdio: 'pipe' });
  } catch (error) {
    refuse(`${name} does not parse:\n${String(error.stderr ?? error.message).slice(0, 800)}`);
  }
}
say(`  ok ${jsFiles.length} js files parse`);

// --- 2. the manifest's entry must exist --------------------------------------
const entry = pkgBefore.main ?? 'lib/index.js';
try {
  await stat(path.join(REPO, entry));
} catch {
  refuse(`package.json main points at ${entry}, which does not exist`);
}
say(`  ok entry point: ${entry}`);

// --- 3. the fork's own surfaces must still be there --------------------------
const client = await readFile(path.join(LIB, 'client.js'), 'utf8');
const REQUIRED = [
  ['seat switcher', 'function SeatAccountSwitcher'],
  ['account list', 'function AccountList'],
  ['switch action', 'switch-account'],
  ['formatTime hardened', 'Number.isNaN(date.getTime())'],
];
for (const [label, marker] of REQUIRED) {
  if (!client.includes(marker)) refuse(`the build is missing the ${label} — this looks like upstream, not the fork`);
}
say(`  ok fork surfaces present (${REQUIRED.length} checked)`);

// --- 4. no account data ------------------------------------------------------
let clean = false;
try {
  const out = execFileSync(process.execPath, [path.join(REPO, 'tools', 'scan-accounts.mjs'), REPO], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  clean = out.includes('CLEAN');
  say(`  ok account scan: ${clean ? 'CLEAN' : 'unexpected output'}`);
} catch (error) {
  say('  x account scan FAILED:');
  say(String(error.stdout ?? '').split('\n').slice(-12).join('\n'));
}
if (!clean) refuse('account scan did not pass — nothing published');

// --- 5. bump the version -----------------------------------------------------
if (VERSION !== previousVersion) {
  const pkg = { ...pkgBefore, version: VERSION };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  say(`  ok version ${previousVersion} -> ${VERSION}`);
} else {
  say(`  ok version unchanged (${VERSION})`);
}

if (DRY_RUN) {
  say('\n(--dry-run) would now commit and push');
  process.exit(0);
}

// --- 6. commit and push ------------------------------------------------------
const git = (args) => execFileSync('git', ['-C', REPO, ...args], { stdio: 'pipe', encoding: 'utf8' });
try {
  git(['add', '-A']);
  const status = git(['status', '--short']);
  if (status.trim() === '') {
    say('\n  nothing to commit — the tree already matches');
    process.exit(0);
  }
  git(['-c', 'user.name=kuanaha1228-gif', '-c', 'user.email=995178633@qq.com', 'commit', '-m',
    `release: ${VERSION}\n\nRewritten from upstream dsh-workbuddy-connect ${VERSION} with the multi-account\nlayer re-spliced, installed and confirmed working on the maintainer's machine\nbefore publishing.`]);
  git(['push', 'origin', 'main']);
} catch (error) {
  refuse(`git failed:\n${String(error.stderr ?? error.message).slice(0, 1200)}`);
}

say('');
say('  ok pushed to origin/main');
say('');
