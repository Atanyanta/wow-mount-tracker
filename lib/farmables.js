// Resolves data/farmables.json (hand-audited daily/weekly kill list) against a
// scanned collection for the Dailies tab. Pure function: data is passed in so
// it works in the browser and in plain node scripts alike, and never touches
// the network - ownership comes from the cached scan already in memory.
//
// - A mount counts as owned if ANY mount with the same name is owned, so the
//   Alliance/Horde twins of one mount (e.g. Grand Black War Mammoth, ids
//   286/287) don't show as missing after the player's faction version is owned.
// - Once a faction is known, opposing-faction mounts the player doesn't own
//   are dropped (same rule as the Collection grid); owned ones always stay.
// - Duplicate names inside one activity collapse to a single row.

// Explicit ".js": this file is also imported by plain Node (docs/qa/qa.mjs).
import { EXPANSION_NAMES } from "./groupMounts.js";

// Quest Log difficulty tiers, by how many expansions ago the content is
// (EXPANSION_NAMES[0] is the current expansion):
//   current or 1 back (Midnight, The War Within)  -> "Not soloable"
//   2 back (Dragonflight)                          -> "Hard"
//   3 or more back (Shadowlands and older)         -> "Easy"
// A rule of thumb for soloing at max level, not a per-boss judgement.
export const DIFFICULTY_TIERS = [
  { id: "easy", label: "Easy" },
  { id: "hard", label: "Hard" },
  { id: "group", label: "Not soloable" },
];

// Tier id for an activity's expansion, or null for an unknown expansion.
export function difficultyTier(expansion) {
  const age = EXPANSION_NAMES.indexOf(expansion);
  if (age < 0) return null;
  if (age <= 1) return "group";
  if (age === 2) return "hard";
  return "easy";
}

export function resolveFarmables({ groups, mounts, ownedIds, faction }) {
  const mountsById = new Map(mounts.map((m) => [m.id, m]));
  const idsByName = new Map();
  for (const m of mounts) {
    if (!idsByName.has(m.name)) idsByName.set(m.name, []);
    idsByName.get(m.name).push(m.id);
  }
  const opposing = faction === "alliance" ? "horde" : faction === "horde" ? "alliance" : null;

  const isOwned = (mount) =>
    !!ownedIds && idsByName.get(mount.name).some((id) => ownedIds.has(id));

  return groups
    .map((group) => {
      const activities = group.activities
        .map((activity) => {
          const seen = new Set();
          const rows = activity.mounts
            .map((fm) => ({ fm, mount: mountsById.get(fm.id) }))
            .filter((r) => r.mount)
            .map((r) => ({ ...r, owned: isOwned(r.mount) }))
            // Prefer the player's own-faction twin when deduping by name.
            .sort((a, b) => Number(a.mount.faction === opposing) - Number(b.mount.faction === opposing))
            .filter((r) => !(opposing && r.mount.faction === opposing && !r.owned))
            .filter((r) => {
              if (seen.has(r.mount.name)) return false;
              seen.add(r.mount.name);
              return true;
            })
            // Restore the curated order after the faction-preference sort.
            .sort((a, b) => activity.mounts.indexOf(a.fm) - activity.mounts.indexOf(b.fm));
          const remaining = rows.filter((r) => !r.owned).length;
          return { ...activity, rows, remaining };
        })
        .filter((a) => a.rows.length > 0);
      return { ...group, activities };
    })
    .filter((g) => g.activities.length > 0);
}
