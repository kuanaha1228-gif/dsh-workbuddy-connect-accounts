/**
 * Match the seat switcher to the control it sits beside.
 *
 * The neighbouring control (ModelProbe's credit row) has no border, no background
 * and no fixed height: it is a 20px transparent glyph button with 11px tertiary
 * text, nudged down 2px to sit on the same baseline. The switcher was built as a
 * bordered 28px pill with a tinted background, which is why it read as a foreign
 * box dropped into the row.
 *
 * This rewrites only the style constants — no structure changes — so the control
 * becomes a quiet inline label like its neighbour: same height, same type size,
 * same muted colour, background and border only on hover.
 *
 *   node tools/match-seat-style.mjs
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Where to patch; `WORKBUDDY_LIB_DIR` addresses a lib/ directory directly. */
const LIB = process.env.WORKBUDDY_LIB_DIR
  ?? path.join(
    process.env.WORKBUDDY_SWITCHACCOUNT_DIR
      ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-workbuddy-switchaccount'),
    'lib',
  );
const CLIENT = path.join(LIB, 'client.js');

let text = (await readFile(CLIENT, 'utf8')).replace(/\r\n/g, '\n');
const before = text;
let failures = 0;

/** Replace one style constant's body. */
function replaceStyle(name, body) {
  const marker = `\t\tconst ${name} = {`;
  const at = text.indexOf(marker);
  if (at < 0) {
    console.error(`${name}: not found`);
    failures += 1;
    return;
  }
  const end = text.indexOf('\n\t\t};', at);
  if (end < 0) {
    console.error(`${name}: no closing brace`);
    failures += 1;
    return;
  }
  text = `${text.slice(0, at)}${marker}${body}\n\t\t};${text.slice(end + '\n\t\t};'.length)}`;
  console.log(`${name}: restyled`);
}

replaceStyle('seatSwitcherStyle', `
			position: "relative",
			display: "inline-flex",
			alignItems: "center",
			transform: "translateY(2px)"
		`);

replaceStyle('seatSwitcherTriggerStyle', `
			/* Same metrics as the credit chip beside it: no border, no fill, 11px
			tertiary text. The control only shows a surface while hovered, so the row
			stays quiet when idle. */
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			height: 20,
			padding: "0 4px",
			border: 0,
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 11,
			lineHeight: "16px",
			cursor: "pointer"
		`);

replaceStyle('seatSwitcherDotStyle', `
			width: 5,
			height: 5,
			borderRadius: "50%",
			background: "var(--dsw-alias-label-tertiary)",
			flex: "none",
			opacity: .7
		`);

replaceStyle('seatSwitcherDotActiveStyle', `
			background: "var(--dsw-alias-brand-primary)",
			opacity: 1
		`);

replaceStyle('seatSwitcherLabelStyle', `
			maxWidth: 96,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		`);

replaceStyle('seatSwitcherMenuStyle', `
			/* The popover keeps a surface — it floats above the composer — but borrows
			the seat's radius and shadow scale rather than inventing its own. */
			position: "absolute",
			bottom: "calc(100% + 6px)",
			left: 0,
			minWidth: 200,
			padding: 4,
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-layer-2)",
			boxShadow: "var(--dsw-shadow-lv2)",
			display: "flex",
			flexDirection: "column",
			gap: 1,
			zIndex: 30
		`);

replaceStyle('seatSwitcherItemStyle', `
			display: "flex",
			alignItems: "center",
			gap: 6,
			width: "100%",
			padding: "5px 6px",
			border: 0,
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			textAlign: "left",
			cursor: "pointer"
		`);

replaceStyle('seatSwitcherItemActiveStyle', `
			background: "var(--dsw-alias-bg-layer-1)"
		`);

replaceStyle('seatSwitcherTextStyle', `
			display: "flex",
			flexDirection: "column",
			gap: 0,
			minWidth: 0
		`);

replaceStyle('seatSwitcherNameStyle', `
			fontSize: 12,
			lineHeight: "16px",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		`);

replaceStyle('seatSwitcherDetailStyle', `
			fontSize: 11,
			lineHeight: "14px",
			color: "var(--dsw-alias-label-tertiary)",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		`);

if (failures > 0) {
  console.error(`\n${failures} style(s) could not be replaced; nothing written.`);
  process.exit(1);
}
if (text === before) {
  console.log('nothing changed');
  process.exit(0);
}

await copyFile(CLIENT, `${CLIENT}.before-style`);
await writeFile(CLIENT, text, 'utf8');

try {
  execFileSync(process.execPath, ['--check', CLIENT], { stdio: 'pipe' });
  console.log('\nsyntax check: pass');
} catch (error) {
  console.error(`syntax FAILED:\n${String(error.stderr ?? error.message)}`);
  await copyFile(`${CLIENT}.before-style`, CLIENT);
  console.error('reverted');
  process.exit(1);
}
console.log(`written ${CLIENT}`);
