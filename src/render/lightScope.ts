/**
 * Makes an element below a dark `<body>` render with the light theme.
 *
 * A `.theme-light` class on the element is not enough. Obsidian's
 * `.theme-light` rule only sets the base palette, while most variables
 * (`--text-faint`, `--background-primary`, `--code-background`, …) are
 * declared on `body` as `var(...)` references. Those are resolved once at
 * `<body>` with the dark palette and inherited as finished values.
 *
 * So we ask the browser what every variable would be on a light `<body>`:
 * swap the class, read the computed values, and swap it back, all in one
 * synchronous task. No frame is painted in between, so nothing flickers.
 * The variables that differ from the dark values are set inline on the
 * wrapper around our root. The root inherits them, and any rule that matches
 * the root or an element below it still wins.
 */

function readCustomProperties(el: HTMLElement): Map<string, string> {
	const computed = getComputedStyle(el);
	const out = new Map<string, string>();
	for (const name of Array.from(computed)) {
		if (name.startsWith("--")) out.set(name, computed.getPropertyValue(name).trim());
	}
	return out;
}

/** Variables whose light-theme value differs from the current (dark) one. */
export function lightThemeOverrides(): Map<string, string> {
	const body = document.body;
	if (!body.classList.contains("theme-dark")) return new Map();

	const dark = readCustomProperties(body);
	let light: Map<string, string>;
	body.classList.replace("theme-dark", "theme-light");
	try {
		light = readCustomProperties(body);
	} finally {
		body.classList.replace("theme-light", "theme-dark");
	}

	const out = new Map<string, string>();
	for (const [name, value] of light) {
		if (dark.get(name) !== value) out.set(name, value);
	}
	return out;
}

/** Inline properties for the wrapper: light-theme variables plus `color-scheme`. */
export function lightScopeProps(): Record<string, string> {
	const props = Object.fromEntries(lightThemeOverrides());
	props["color-scheme"] = "light";
	return props;
}
