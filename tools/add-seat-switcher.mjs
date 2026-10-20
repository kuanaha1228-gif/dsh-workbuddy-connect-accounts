/**
 * Give switchaccount a composer-seat account switcher.
 *
 * The package already registers into `conversation.input.right`, but the component
 * it registers renders only the reasoning-effort probe — there is no account
 * control, so the only way to switch is the settings card. This adds a compact
 * dropdown beside the probe, styled with DSH tokens like the rest of the seat.
 *
 * It reuses the document the card already consumes: `status.accounts`,
 * `status.selectedAccount` and `status.probeKey`, and posts the same
 * `switch-account` action with `archiveKey`.
 *
 *   node tools/add-seat-switcher.mjs            patch the installed package
 *   node tools/add-seat-switcher.mjs --check    report without writing
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Where to patch.
 *
 * `WORKBUDDY_LIB_DIR` points at a `lib/` directory directly, which is how
 * `reapply-ui.mjs` drives this script against the repository tree instead of an
 * installed copy.
 */
const LIB = process.env.WORKBUDDY_LIB_DIR
  ?? path.join(
    process.env.WORKBUDDY_SWITCHACCOUNT_DIR
      ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-workbuddy-switchaccount'),
    'lib',
  );
const CLIENT = path.join(LIB, 'client.js');
const CHECK = process.argv.includes('--check');

let text = (await readFile(CLIENT, 'utf8')).replace(/\r\n/g, '\n');
if (text.includes('function SeatAccountSwitcher(')) {
  console.log('seat switcher already present — nothing to do');
  process.exit(0);
}

/** The dropdown component, inserted before WorkBuddyProbeControl. */
const SWITCHER = `		/**
		* Accessible name for the seat switcher.
		*
		* The package has no dedicated key for it, and adding one would need new
		* entries in both dictionaries; reusing the card's own section heading keeps
		* the wording consistent without touching the locale tables.
		*/
		function seatSwitcherLabel(t) {
			return t("accountListHeading");
		}
		/**
		* Compact account switcher for the composer seat.
		*
		* Reads the same status document the settings card uses and posts the same
		* switch-account action, so the two surfaces cannot disagree about which
		* account is in use. Hidden when there is nothing to choose: one account,
		* a signed-out document, or no document yet.
		*/
		function SeatAccountSwitcher({ t }) {
			const [status, setStatus] = (0, react.useState)(void 0);
			const [open, setOpen] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const boxRef = (0, react.useRef)(null);

			// One read on mount, refreshed when the popover opens: the seat is shared by
			// every session, so polling here would multiply requests by session count.
			const load = (0, react.useCallback)(async (signal) => {
				try {
					const response = await fetch(WORKBUDDY_STATUS_PATH, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						signal
					});
					if (!response.ok) return;
					const value = await response.json();
					if (typeof value === "object" && value !== null && typeof value.status === "string") setStatus(value);
				} catch {
					// A failed read leaves the previous document; the card reports the failure.
				}
			}, []);

			(0, react.useEffect)(() => {
				const controller = new AbortController();
				load(controller.signal);
				return () => controller.abort();
			}, [load]);

			(0, react.useEffect)(() => {
				if (!open) return void 0;
				const onPointerDown = (event) => {
					if (boxRef.current !== null && !boxRef.current.contains(event.target)) setOpen(false);
				};
				document.addEventListener("mousedown", onPointerDown, true);
				return () => document.removeEventListener("mousedown", onPointerDown, true);
			}, [open]);

			const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
			if (status?.status !== "signed-in" || accounts.length < 2) return null;

			const selected = status.selectedAccount ?? "";
			const chosen = accounts.find((account) => account.archiveKey === selected || account.account === selected) ?? accounts[0];

			const choose = async (account) => {
				setOpen(false);
				if (busy) return;
				const key = status.probeKey;
				if (key === void 0) return;
				setBusy(true);
				try {
					const response = await fetch(WORKBUDDY_PROBE_PATH, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						credentials: "same-origin",
						body: JSON.stringify({
							action: "switch-account",
							archiveKey: account.archiveKey ?? account.account
						})
					});
					if (response.ok) await load();
				} catch {
					// The card surfaces the failure reason; the seat just stops spinning.
				} finally {
					setBusy(false);
				}
			};

			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: boxRef,
				style: seatSwitcherStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-label": seatSwitcherLabel(t),
					"aria-haspopup": "menu",
					"aria-expanded": open,
					title: seatSwitcherLabel(t),
					disabled: busy,
					onClick: () => setOpen((previous) => !previous),
					style: seatSwitcherTriggerStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: seatSwitcherDotStyle,
						"aria-hidden": "true"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: seatSwitcherLabelStyle,
						children: chosen.nickname ?? chosen.uid ?? seatSwitcherLabel(t)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						width: 12,
						height: 12,
						viewBox: "0 0 24 24",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: 2,
						strokeLinecap: "round",
						strokeLinejoin: "round",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m6 9 6 6 6-6" })
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					role: "menu",
					style: seatSwitcherMenuStyle,
					children: accounts.map((account) => {
						const key = account.archiveKey ?? account.account;
						const isCurrent = key === (chosen.archiveKey ?? chosen.account);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "menuitemradio",
							"aria-checked": isCurrent,
							disabled: busy,
							onClick: () => choose(account),
							style: {
								...seatSwitcherItemStyle,
								...isCurrent ? seatSwitcherItemActiveStyle : {}
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									...seatSwitcherDotStyle,
									...isCurrent ? seatSwitcherDotActiveStyle : {}
								},
								"aria-hidden": "true"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: seatSwitcherTextStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: seatSwitcherNameStyle,
									children: account.nickname ?? account.uid ?? key
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: seatSwitcherDetailStyle,
									children: typeof account.refreshExpiresAtMs === "number" && account.refreshExpiresAtMs > 0
										? formatTime(account.refreshExpiresAtMs)
										: t("accountExpired")
								})]
							})]
						}, key);
					})
				}) : null]
			});
		}
`;

/** Styles, matching the seat's existing tokens. */
const STYLES = `		const seatSwitcherStyle = {
			position: "relative",
			display: "inline-flex"
		};
		const seatSwitcherTriggerStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			height: 28,
			padding: "0 8px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "16px",
			cursor: "pointer"
		};
		const seatSwitcherDotStyle = {
			width: 6,
			height: 6,
			borderRadius: "50%",
			background: "var(--dsw-alias-label-tertiary)",
			flex: "none"
		};
		const seatSwitcherDotActiveStyle = {
			background: "var(--dsw-alias-brand-primary)"
		};
		const seatSwitcherLabelStyle = {
			maxWidth: 120,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const seatSwitcherMenuStyle = {
			position: "absolute",
			bottom: "calc(100% + 8px)",
			left: 0,
			minWidth: 220,
			padding: 4,
			borderRadius: 10,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-layer-2)",
			boxShadow: "var(--dsw-shadow-lv2)",
			display: "flex",
			flexDirection: "column",
			gap: 2,
			zIndex: 30
		};
		const seatSwitcherItemStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			width: "100%",
			padding: "6px 8px",
			borderRadius: 8,
			border: "none",
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			textAlign: "left",
			cursor: "pointer"
		};
		const seatSwitcherItemActiveStyle = {
			background: "var(--dsw-alias-bg-layer-1)"
		};
		const seatSwitcherTextStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 1,
			minWidth: 0
		};
		const seatSwitcherNameStyle = {
			fontSize: 12,
			lineHeight: "16px",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const seatSwitcherDetailStyle = {
			fontSize: 11,
			lineHeight: "14px",
			color: "var(--dsw-alias-label-tertiary)",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
`;

const SWITCHER_SRC = SWITCHER;
const STYLES_SRC = STYLES;

// 1. Insert the component before WorkBuddyProbeControl.
const controlAt = text.indexOf('\t\tfunction WorkBuddyProbeControl(');
if (controlAt < 0) {
  console.error('could not find WorkBuddyProbeControl');
  process.exit(1);
}
text = `${text.slice(0, controlAt)}${SWITCHER_SRC}${STYLES_SRC}${text.slice(controlAt)}`;

// 2. Render it beside the probe. The component currently returns ModelProbe directly.
const RETURN_OLD = `			return card === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelProbe, {
				model: selection.model,
				card,
				label: useLabel(t),
				t
			}, \`\${card.id}:\${selection.model}\`);`;

const RETURN_NEW = `			const probe = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelProbe, {
				model: selection.model,
				card,
				label: useLabel(t),
				t
			}, \`\${card.id}:\${selection.model}\`);
			if (card === void 0) return null;
			/* The account switcher sits beside the probe, in the same seat row, and
			* hides itself when there is only one account to choose from. */
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 8
				},
				children: [probe, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SeatAccountSwitcher, { t })]
			});`;

if (text.includes(RETURN_NEW)) {
  console.log('seat render already patched');
} else if (text.includes(RETURN_OLD)) {
  text = text.replace(RETURN_OLD, RETURN_NEW);
  console.log('probe control: renders the switcher beside the probe');
} else {
  console.error('could not find the probe control return statement');
  process.exit(1);
}

// The component source contains template-literal syntax of its own, which would be
// evaluated while building SWITCHER if it were spelled directly. It is written with
if (CHECK) {
  console.log('(check only — nothing written)');
  process.exit(0);
}

await copyFile(CLIENT, `${CLIENT}.before-seat`);
await writeFile(CLIENT, text, 'utf8');

try {
  execFileSync(process.execPath, ['--check', CLIENT], { stdio: 'pipe' });
  console.log('syntax check: pass');
} catch (error) {
  console.error(`syntax FAILED:\n${String(error.stderr ?? error.message)}`);
  await copyFile(`${CLIENT}.before-seat`, CLIENT);
  console.error('reverted');
  process.exit(1);
}
console.log(`written ${CLIENT}`);
void fileURLToPath;
