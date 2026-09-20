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
