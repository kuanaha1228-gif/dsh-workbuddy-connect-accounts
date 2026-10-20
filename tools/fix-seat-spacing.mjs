/**
 * Two small corrections after the restyle.
 *
 * The wrapper already centres its children, and ModelProbe applies its own 2px
 * nudge; a second translateY on the switcher would push it down twice. And with
 * ModelProbe carrying `marginRight: -8`, an 8px gap on the wrapper opens a hole
 * between the two controls.
 *
 *   node tools/fix-seat-spacing.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CLIENT = path.join(
  process.env.WORKBUDDY_SWITCHACCOUNT_DIR
    ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-workbuddy-switchaccount'),
  'lib',
  'client.js',
);

let text = (await readFile(CLIENT, 'utf8')).replace(/\r\n/g, '\n');
const before = text;

// 1. Drop the switcher's own translateY: the wrapper centres it already.
const withTransform = `			position: "relative",
			display: "inline-flex",
			alignItems: "center",
			transform: "translateY(2px)"`;
const withoutTransform = `			position: "relative",
			display: "inline-flex",
			alignItems: "center"`;
if (text.includes(withTransform)) {
  text = text.replace(withTransform, withoutTransform);
  console.log('removed the switcher translateY');
} else if (text.includes(withoutTransform)) {
  console.log('translateY already absent');
} else {
  console.error('could not find seatSwitcherStyle body');
  process.exit(1);
}

// 2. Tighten the wrapper gap so the two controls sit at the seat's own rhythm.
const wideGap = `				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 8
				},
				children: [probe`;
const tightGap = `				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 2
				},
				children: [probe`;
if (text.includes(wideGap)) {
  text = text.replace(wideGap, tightGap);
  console.log('wrapper gap 8 -> 2');
} else if (text.includes(tightGap)) {
  console.log('gap already tight');
} else {
  console.error('could not find the wrapper style');
  process.exit(1);
}

if (text === before) {
  console.log('nothing to change');
  process.exit(0);
}

await writeFile(CLIENT, text, 'utf8');
try {
  execFileSync(process.execPath, ['--check', CLIENT], { stdio: 'pipe' });
  console.log('syntax check: pass');
} catch (error) {
  console.error(`syntax FAILED:\n${String(error.stderr ?? error.message)}`);
  process.exit(1);
}
