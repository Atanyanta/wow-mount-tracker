// The look axes a theme is built from. Each axis maps to a `data-<key>`
// attribute on <html>; the CSS for every option lives in app/themes.css.
// For every axis except `palette`, "default" means "attribute absent" (the
// original plain look). A theme (lib/themes.js) picks one option per axis.

export const STYLE_AXES = [
  {
    key: "palette",
    label: "Palette",
    options: [
      { id: "dark", label: "Dark" },
      { id: "light", label: "Light" },
      { id: "void", label: "Void" },
      { id: "alliance", label: "Alliance" },
      { id: "horde", label: "Horde" },
      { id: "gold", label: "Azeroth Gold" },
    ],
  },
  {
    key: "type",
    label: "Headings",
    options: [
      { id: "default", label: "Sans (current)" },
      { id: "serif", label: "Serif" },
      { id: "engraved", label: "Engraved caps" },
    ],
  },
  {
    key: "dividers",
    label: "Dividers",
    options: [
      { id: "default", label: "Plain line" },
      { id: "gilded", label: "Gilded diamond" },
      { id: "banner", label: "Banner rules" },
      { id: "band", label: "Ruled band" },
    ],
  },
  {
    key: "cards",
    label: "Cards",
    options: [
      { id: "default", label: "Flat" },
      { id: "framed", label: "Framed corners" },
      { id: "plaque", label: "Plaque" },
      { id: "glow", label: "Soft glow" },
    ],
  },
  {
    key: "owned",
    label: "Collected mounts",
    options: [
      { id: "default", label: "Green border" },
      { id: "dim", label: "Dim missing" },
      { id: "badge", label: "Check badge" },
      { id: "ring", label: "Glow ring + badge" },
      { id: "silhouette", label: "Silhouette missing" },
    ],
  },
  {
    key: "progress",
    label: "Progress",
    options: [
      { id: "default", label: "Text only" },
      { id: "counts", label: "Counts beside headings" },
      { id: "bars", label: "XP-style bars (count inside)" },
    ],
  },
];
