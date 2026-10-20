#!/usr/bin/env node
/**
 * Daily upstream check for the multi-account WorkBuddy plugin.
 *
 * Compares the version this repository ships against the one upstream publishes,
 * and when they differ, prepares everything that can be prepared without judgement:
 *
 *   .upstream-<version>/package/   the new upstream build, unpacked
 *   .upstream-<version>/diff.md    what upstream changed, with the multi-account
 *                                  code called out so the rewrite has a starting point
 *   .upstream-<version>/backup/    this machine's installed plugin, so a failed
 *                                  rewrite can be undone by copying it back
 *
 * It then stops and reports. Rewriting the multi-account layer into a new upstream
 * structure is a judgement call, not a script: the two parts of this plugin that
 * can be applied mechanically (the composer switcher and its styling) have their
 * own scripts, but splicing the account archive, the vault and the routes needs a
 * reader who can see where upstream moved things.
 *
 * Exit codes are the interface:
 *   0  versions match — nothing to do
 *   10 a new upstream version is available and staged — awaiting a decision
 *   20 the download or the diff failed
 *   1  an operational error (network, malformed package)
 *
 *   node automation/check-upstream.mjs
 *   node automation/check-upstream.mjs --dry-run   # only report the version
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.dirname(HERE);
const WORK_ROOT = path.dirname(REPO_DIR);
const DRY_RUN = process.argv.includes('--dry-run');
const UPSTREAM = 'dsh-workbuddy-connect';
const REPORT_FILE = path.join(HERE, 'last-check.json');

const readJson = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));

/** The version this repository publishes. */
async function repoVersion() {
  const pkg = await readJson(path.join(REPO_DIR, 'package.json'));
  if (typeof pkg.version !== 'string') throw new Error('repository package.json has no version');
  return pkg.version;
}

async function upstreamVersion() {
  const response = await fetch(`https://registry.npmjs.org/${UPSTREAM}/latest`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`registry answered ${response.status}`);
  const doc = await response.json();
  if (typeof doc.version !== 'string') throw new Error('registry document has no version');
  return { version: doc.version, tarball: doc.dist?.tarball };
}

/** Download and unpack a published version; returns its package directory. */
async function fetchUpstream({ version, tarball }, into) {
  if (typeof tarball !== 'string') throw new Error('registry document has no tarball URL');
  const response = await fetch(tarball, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`tarball answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const archive = path.join(into, 'upstream.tgz');
  await writeFile(archive, bytes);
  await mkdir(path.join(into, 'package'), { recursive: true });
  // Windows ships bsdtar, which reads this tarball without extra tooling.
  execFileSync('tar', ['-xzf', archive, '-C', into], { stdio: 'pipe' });
  await rm(archive, { force: true });

  const pkgDir = path.join(into, 'package');
  await stat(pkgDir);
  return { pkgDir, sha256, version };
}

/** Every file of the new build with its size, for the diff summary. */
async function inventory(dir) {
  const out = new Map();
  async function walk(current, prefix) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, relative);
      else out.set(relative, (await stat(full)).size);
    }
  }
  await walk(dir, '');
  return out;
}

/**
 * The multi-account surface in this repository, named so the diff can say which
 * of upstream's changes land on it.
 */
const MULTI_ACCOUNT_MARKERS = [
  'WorkBuddyAccountVault',
  'switch-account',
  'remove-account',
  'archiveKey',
  'SeatAccountSwitcher',
  'AccountList',
];

/** What upstream changed relative to the version this repo was built from. */
async function diffReport(newPkgDir, repoVersionUsed, hashes) {
  const lines = [];
  lines.push(`# Upstream ${UPSTREAM} → new version`);
  lines.push('');
  lines.push(`This repository is built from **${UPSTREAM} ${repoVersionUsed}**.`);
  lines.push('');

  const oldLib = path.join(WORK_ROOT, '.upstream-baseline', 'lib');
  const newLib = path.join(newPkgDir, 'lib');
  const newFiles = await inventory(newLib).catch(() => new Map());
  const oldFiles = await inventory(oldLib).catch(() => new Map());

  lines.push('## Files in the new build');
  lines.push('');
  if (newFiles.size === 0) {
    lines.push('_(no lib/ in the new package)_');
  } else {
    for (const [name, size] of [...newFiles].sort()) {
      const before = oldFiles.get(name);
      let note = 'new';
      if (before !== undefined) {
        if (before === size) note = 'unchanged size';
        else note = `size ${before} → ${size}`;
      }
      lines.push(`- \`${name}\` — ${size} bytes (${note})`);
    }
  }
  for (const name of oldFiles.keys()) {
    if (!newFiles.has(name)) lines.push(`- \`${name}\` — **gone from upstream**`);
  }

  lines.push('');
  lines.push('## Multi-account surface in this repository');
  lines.push('');
  lines.push('These identifiers are what a rewrite has to preserve. Check each one against');
  lines.push('the new build: if upstream renamed or moved the surrounding code, the splice');
  lines.push('point changes with it.');
  lines.push('');
  const repoLib = await readdir(path.join(REPO_DIR, 'lib')).catch(() => []);
  for (const marker of MULTI_ACCOUNT_MARKERS) {
    const hits = [];
    for (const name of repoLib) {
      if (!name.endsWith('.js')) continue;
      const text = await readFile(path.join(REPO_DIR, 'lib', name), 'utf8').catch(() => '');
      if (text.includes(marker)) hits.push(name);
    }
    lines.push(`- \`${marker}\` — present in ${hits.join(', ') || '(nothing)'}`);
  }

  lines.push('');
  lines.push('## Rewrite checklist');
  lines.push('');
  lines.push('1. Read `git diff` of upstream\'s host half against the baseline.');
  lines.push('2. Re-splice the account archive, the vault and the two control actions.');
  lines.push('3. Run `node tools/reapply-ui.mjs --check`, then without `--check`.');
  lines.push('4. `node tools/scan-accounts.mjs .` must print CLEAN.');
  lines.push('5. Install, restart DSH, and have the user confirm the four things:');
  lines.push('   version, account card expands with every account, switching works,');
  lines.push('   WorkBuddy models are selectable.');
  lines.push('6. Only after the user says the build is good: push.');
  lines.push('');
  lines.push(`_Upstream tarball sha256: ${hashes}_`);
  return lines.join('\n');
}

/** Back up this machine's installed plugin so a failed rewrite is reversible. */
async function backupInstalled(into) {
  const dshHome = process.env.DSH_HOME?.trim()
    ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh');
  const candidates = [
    path.join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-workbuddy-switchaccount'),
    path.join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-workbuddy-connect'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const target = path.join(into, 'backup');
    await mkdir(target, { recursive: true });
    await cp(path.join(candidate, 'lib'), path.join(target, 'lib'), { recursive: true, force: true });
    await cp(path.join(candidate, 'package.json'), path.join(target, 'package.json'), { force: true });
    return candidate;
  }
  return undefined;
}

async function runOnce(report) {
  report.repo = await repoVersion();
  report.upstream = (await upstreamVersion()).version;
  console.log(`repository : ${report.repo}`);
  console.log(`upstream   : ${report.upstream}`);

  if (report.upstream === report.repo) {
    report.action = 'up-to-date';
    console.log('\nUP-TO-DATE — no new upstream release');
    return 0;
  }

  console.log(`\nNEW RELEASE: ${report.repo} -> ${report.upstream}`);
  if (DRY_RUN) {
    report.action = 'update-available';
    console.log('(dry run: not downloading)');
    return 10;
  }

  const staging = path.join(WORK_ROOT, `.upstream-${report.upstream}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  const meta = await upstreamVersion();
  const { pkgDir, sha256 } = await fetchUpstream(meta, staging);
  report.tarballSha256 = sha256;
  console.log(`downloaded : ${pkgDir}`);
  console.log(`sha256     : ${sha256}`);

  const backupOf = await backupInstalled(staging);
  report.backupOf = backupOf;
  if (backupOf !== undefined) console.log(`backed up  : ${backupOf}`);

  await writeFile(path.join(staging, 'diff.md'), await diffReport(pkgDir, report.repo, sha256), 'utf8');
  console.log(`report     : ${path.join(staging, 'diff.md')}`);

  report.action = 'staged';
  report.staging = staging;

  console.log('');
  console.log('STAGED — nothing was installed, nothing was pushed.');
  console.log('Next: decide whether to rewrite the multi-account layer onto this build.');
  return 10;
}

const report = { at: new Date().toISOString(), repo: undefined, upstream: undefined, action: undefined };
let code = 1;
try {
  code = await runOnce(report);
} catch (error) {
  report.action = 'error';
  report.failure = String(error?.message ?? error);
  console.error(`\nERROR: ${report.failure}`);
  code = 1;
}
await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {});
process.exitCode = code;
