// Theme registry. A theme is a named bundle of picks - one option per axis in
// lib/styleOptions.js. To change what a theme looks like, edit its `picks`; to
// add a theme, add an entry (and, if it needs new colours, a
// `html[data-palette="<id>"]` block in app/themes.css).
//
// Every theme currently shares the same look on the non-palette axes (see
// SHARED below) and differs only by palette. To make one theme diverge, give it
// its own value for that axis. Use the "Customize theme" panel
// (components/StylePicker.js) to try axis changes on top of a theme first.
//
// `swatch` is [background, accent] and only feeds the round chips in the
// switcher (CSS variables can't be read across themes, so they're repeated).
//
// Dark must stay first: it's the default (rendered server-side on <html>, so
// there's no flash), and unknown/removed theme ids fall back to THEMES[0].

export const THEME_STORAGE_KEY = "wow-mount-tracker:theme";

const SHARED = {
  type: "engraved",
  dividers: "banner",
  cards: "plaque",
  owned: "dim",
  progress: "bars",
};

export const THEMES = [
  { id: "dark", label: "Dark", swatch: ["#0a0a0a", "#ffd100"], picks: { palette: "dark", ...SHARED } },
  { id: "light", label: "Light", swatch: ["#efe3c6", "#8c5a10"], picks: { palette: "light", ...SHARED } },
  { id: "void", label: "Void", swatch: ["#0d0916", "#b78cf7"], picks: { palette: "void", ...SHARED } },
  { id: "alliance", label: "Alliance", swatch: ["#0a101d", "#d9b44a"], picks: { palette: "alliance", ...SHARED } },
  { id: "horde", label: "Horde", swatch: ["#110b0a", "#e2692b"], picks: { palette: "horde", ...SHARED } },
  // Extra carried over from the first round of style experiments - keep,
  // rework or delete.
  { id: "gold", label: "Azeroth Gold", swatch: ["#15110b", "#e8b923"], picks: { palette: "gold", ...SHARED } },
];

// The "Customize theme" panel (components/StylePicker.js) is hidden by default.
// Set NEXT_PUBLIC_THEME_CUSTOMIZER=1 in .env.local and restart `npm run dev` to
// bring it back. While it's off, any per-axis overrides saved earlier are
// ignored, so a hidden override can't silently change a theme.
export const CUSTOMIZER_ENABLED = process.env.NEXT_PUBLIC_THEME_CUSTOMIZER === "1";

export const DEFAULT_THEME_ID = THEMES[0].id;

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// { palette: "dark", dividers: "gilded", ... } -> { "data-palette": "dark", ... }
// (options equal to "default" mean "no attribute").
export function picksToAttributes(picks) {
  return Object.fromEntries(
    Object.entries(picks)
      .filter(([, value]) => value && value !== "default")
      .map(([key, value]) => [`data-${key}`, value])
  );
}
