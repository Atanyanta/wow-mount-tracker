// Realm lookup + search over data/realms.json (built by `npm run build:realms`).
// Pure functions, shared by the type-ahead in the search bar and by the API
// route (so a typo can't get through either way).
//
// Matching ignores case, accents, apostrophes, hyphens and spaces, so
// "kel thuzad", "Kel'Thuzad" and "kelthuzad" all find the same realm, and
// "Azjol-Nerub" finds the realm whose real slug is "azjolnerub".
import realmData from "@/data/realms.json";

// Lower-cased, accent-stripped text with punctuation collapsed to single spaces.
export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const compact = (text) => normalizeText(text).replace(/ /g, "");

const indexCache = new Map();
function indexFor(region) {
  if (indexCache.has(region)) return indexCache.get(region);
  const realms = (realmData.regions?.[region] ?? []).map((realm) => {
    const nameNorm = normalizeText(realm.name);
    const slugNorm = normalizeText(realm.slug);
    return { ...realm, nameNorm, slugNorm, nameKey: nameNorm.replace(/ /g, ""), slugKey: slugNorm.replace(/ /g, "") };
  });
  const index = { realms, byKey: new Map() };
  for (const r of realms) {
    index.byKey.set(r.nameKey, r);
    index.byKey.set(r.slugKey, r);
  }
  indexCache.set(region, index);
  return index;
}

export const REALMS_GENERATED_AT = realmData.generatedAt;

// All realms for a region, sorted by name. Empty array if the region has no
// list (then callers fall back to free text rather than blocking the search).
export function getRealms(region) {
  return indexFor(region).realms;
}

// Exact match (by name or slug, using the loose matching above), or null.
export function findRealm(region, text) {
  const key = compact(text);
  if (!key) return null;
  return indexFor(region).byKey.get(key) ?? null;
}

// Ranked search for the type-ahead: prefix of the name/slug first, then a word
// that starts with the query, then any substring. An empty query lists every
// realm. Returns at most `limit` realms.
export function searchRealms(region, query, limit = 80) {
  const { realms } = indexFor(region);
  const q = normalizeText(query);
  if (!q) return realms.slice(0, limit);
  const qKey = q.replace(/ /g, "");
  const scored = [];
  for (const r of realms) {
    let rank = -1;
    if (r.nameKey === qKey || r.slugKey === qKey) rank = 0;
    else if (r.nameKey.startsWith(qKey) || r.slugKey.startsWith(qKey)) rank = 1;
    else if (r.nameNorm.split(" ").some((w) => w.startsWith(q)) || r.slugNorm.split(" ").some((w) => w.startsWith(q))) rank = 2;
    else if (r.nameKey.includes(qKey) || r.slugKey.includes(qKey)) rank = 3;
    if (rank >= 0) scored.push({ r, rank });
  }
  scored.sort((a, b) => a.rank - b.rank); // stable: keeps the alphabetical order within a rank
  return scored.slice(0, limit).map((s) => s.r);
}

function editDistance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

// "Did you mean ...?" for text that matches nothing: the closest realms by edit
// distance, within a tolerance that grows with the length of what was typed.
export function suggestRealms(region, text, count = 3) {
  const key = compact(text);
  if (key.length < 3) return [];
  const tolerance = Math.max(2, Math.floor(key.length * 0.34));
  return indexFor(region)
    .realms.map((r) => ({ r, d: Math.min(editDistance(key, r.nameKey), editDistance(key, r.slugKey)) }))
    .filter((x) => x.d <= tolerance)
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((x) => x.r);
}
