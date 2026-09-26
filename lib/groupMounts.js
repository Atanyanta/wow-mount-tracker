// Patch strings look like "Patch 8.0" or "Patch 11.1.0". Parse into a
// comparable tuple so sections sort chronologically instead of as text
// (which would put "Patch 12.0" before "Patch 2.0").
function parsePatchVersion(patch) {
  if (!patch) return null;
  const match = patch.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function comparePatch(a, b) {
  const va = parsePatchVersion(a);
  const vb = parsePatchVersion(b);
  if (!va && !vb) return 0;
  if (!va) return 1; // unknown patch sorts last
  if (!vb) return -1;
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return vb[i] - va[i]; // newest first
  }
  return 0;
}

// Major patch version -> expansion name, newest first.
const EXPANSIONS = [
  [12, "Midnight"],
  [11, "The War Within"],
  [10, "Dragonflight"],
  [9, "Shadowlands"],
  [8, "Battle for Azeroth"],
  [7, "Legion"],
  [6, "Warlords of Draenor"],
  [5, "Mists of Pandaria"],
  [4, "Cataclysm"],
  [3, "Wrath of the Lich King"],
  [2, "The Burning Crusade"],
  [1, "Classic"],
];
const UNKNOWN_EXPANSION = "Unknown expansion";

// Expansion names, newest (current) first. The Quest Log's difficulty tiers
// count back from the first entry, so adding a new expansion above shifts them.
export const EXPANSION_NAMES = EXPANSIONS.map(([, name]) => name);

function expansionForPatch(patch) {
  const version = parsePatchVersion(patch);
  if (!version) return UNKNOWN_EXPANSION;
  const found = EXPANSIONS.find(([major]) => major === version[0]);
  return found ? found[1] : UNKNOWN_EXPANSION;
}

// Source categories that get pulled out of the expansion/patch hierarchy
// into their own standalone sections at the end - these are things people
// tend to browse as a set regardless of when they were added (e.g. "what
// PvP mounts exist") rather than by patch.
const CROSSCUTTING_CATEGORIES = ["PvP", "Trading Post"];

function groupBySourceCategory(mounts) {
  const bySource = new Map();
  for (const mount of mounts) {
    const key = mount.sourceCategory || "Unknown source";
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(mount);
  }
  const sources = [...bySource.keys()].sort((a, b) => {
    if (a === "Unknown source") return 1;
    if (b === "Unknown source") return -1;
    return a.localeCompare(b);
  });
  return sources.map((source) => ({
    source,
    mounts: bySource.get(source).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

function groupByPatch(mounts, { withSources }) {
  const byPatch = new Map();
  for (const mount of mounts) {
    const key = mount.patch || "Unknown patch";
    if (!byPatch.has(key)) byPatch.set(key, []);
    byPatch.get(key).push(mount);
  }
  const patches = [...byPatch.keys()].sort((a, b) => {
    if (a === "Unknown patch") return 1;
    if (b === "Unknown patch") return -1;
    return comparePatch(a, b);
  });
  return patches.map((patch) => ({
    patch,
    sources: withSources
      ? groupBySourceCategory(byPatch.get(patch))
      : [{ source: null, mounts: byPatch.get(patch).sort((a, b) => a.name.localeCompare(b.name)) }],
  }));
}

// Titles of the sections groupMounts() would return for `mounts` (expansion
// names plus the crosscut section titles), without building the groups - used
// for "collapse all" from outside the grid.
export function sectionTitles(mounts) {
  const titles = new Set();
  for (const mount of mounts) {
    titles.add(
      CROSSCUTTING_CATEGORIES.includes(mount.sourceCategory)
        ? mount.sourceCategory
        : expansionForPatch(mount.patch)
    );
  }
  return [...titles];
}

// Returns { expansions, crosscutSections }.
// expansions: [{ expansion, patches: [{ patch, sources: [{ source, mounts }] }] }]
// crosscutSections: [{ title, patches: [{ patch, sources: [{ source: null, mounts }] }] }]
export function groupMounts(mounts) {
  const crosscut = new Map();
  const rest = [];
  for (const mount of mounts) {
    if (CROSSCUTTING_CATEGORIES.includes(mount.sourceCategory)) {
      const key = mount.sourceCategory;
      if (!crosscut.has(key)) crosscut.set(key, []);
      crosscut.get(key).push(mount);
    } else {
      rest.push(mount);
    }
  }

  const byExpansion = new Map();
  for (const mount of rest) {
    const key = expansionForPatch(mount.patch);
    if (!byExpansion.has(key)) byExpansion.set(key, []);
    byExpansion.get(key).push(mount);
  }
  const expansionNames = [...byExpansion.keys()].sort((a, b) => {
    if (a === UNKNOWN_EXPANSION) return 1;
    if (b === UNKNOWN_EXPANSION) return -1;
    const ai = EXPANSIONS.findIndex(([, name]) => name === a);
    const bi = EXPANSIONS.findIndex(([, name]) => name === b);
    return ai - bi;
  });
  const expansions = expansionNames.map((expansion) => ({
    expansion,
    patches: groupByPatch(byExpansion.get(expansion), { withSources: true }),
  }));

  const crosscutSections = CROSSCUTTING_CATEGORIES.filter((cat) => crosscut.has(cat)).map(
    (title) => ({
      title,
      patches: groupByPatch(crosscut.get(title), { withSources: false }),
    })
  );

  return { expansions, crosscutSections };
}
