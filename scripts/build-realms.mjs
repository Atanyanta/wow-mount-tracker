// Builds data/realms.json: the list of real player realms per region, used by
// the realm type-ahead in the search bar and by /api/collections validation.
//
// Source: Blizzard Game Data API realm index (/data/wow/realm/index,
// namespace dynamic-{region}) - the same credentials as the rest of the app.
// The list is fetched here, once, and committed; nothing hits the network at
// page load. Realms change rarely (a new realm, a rename, or a merge), so just
// re-run this when a realm can't be found:
//
//   npm run build:realms
//
// Names are localised per region (ko_KR for KR, zh_TW for TW); slugs are always
// Blizzard's own, which are NOT derivable from the name (e.g. "Azjol-Nerub" is
// "azjolnerub", "Aggra (Portugues)" is "aggra-portugues"), which is why the slug
// is stored and used for API calls rather than being guessed from typed text.
//
// Safety: all four regions are fetched and sanity-checked before anything is
// written, so a failed or truncated response can never replace a good list.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "data", "realms.json");

const REGIONS = [
  { id: "us", locale: "en_US", collate: "en" },
  { id: "eu", locale: "en_GB", collate: "en" },
  { id: "kr", locale: "ko_KR", collate: "ko" },
  { id: "tw", locale: "zh_TW", collate: "zh-TW" },
];
// A real region has at least this many realms; fewer means the response is bad.
const MIN_REALMS = { us: 150, eu: 150, kr: 10, tw: 10 };

// The index also lists Blizzard's internal pseudo-realms (shard/instance
// servers, account realms, test realms). They aren't places a character lives,
// so they are dropped. Kept deliberately narrow: legitimate realms such as
// "Twisting Nether", "Krag'jin" or "Area 52" must survive.
const INTERNAL = [
  /-INST/i, //                       US1A2-INST, EU4A1-INST-BFA, TW2A1-INST-DFT
  /account realm/i, //               US1A Account Realm, EU3B Account Realm OLD AU
  /^(US|EU|KR|TW|AU)\d/i, //         EU7A-BG-RU, "US1 100 Partner", "EU4 100 Partner"
  /^(US|EU|KR|TW)\s+(auxiliary|보조)/i, // US Auxiliary 70, KR 보조 70, TW Auxiliary 170
  /arena pass/i, //                  EU Arena Pass CSBG
  /^zzz/i, //                        zzz_RDB EU
  /^gmsupport/i, //                  GMSupport TW2-01 (Blizzard support realms)
  /^rdb\s/i, //                      RDB US / RDB EU / RDB KR / RDB TW
];
const isInternal = (r) => INTERNAL.some((rx) => rx.test(r.name) || rx.test(r.slug));

async function getToken() {
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET not set (run via `npm run build:realms`)");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function fetchRegion(token, { id, locale, collate }) {
  const url = `https://${id}.api.blizzard.com/data/wow/realm/index?namespace=dynamic-${id}&locale=${locale}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${id}: realm index request failed (${res.status})`);
  const { realms } = await res.json();
  if (!Array.isArray(realms)) throw new Error(`${id}: unexpected response shape`);
  const all = realms.map((r) => ({ name: String(r.name), slug: String(r.slug) }));
  const kept = all.filter((r) => !isInternal(r));
  kept.sort((a, b) => a.name.localeCompare(b.name, collate, { sensitivity: "base" }));
  return { all, kept, dropped: all.filter(isInternal) };
}

// Lookup key used by the app for matching typed text: accents/case/punctuation/
// spaces ignored. Two realms sharing a key would be indistinguishable to a user
// typing, so refuse to write a list that contains such a pair.
const compact = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const token = await getToken();
const result = {};
const problems = [];
for (const region of REGIONS) {
  const r = await fetchRegion(token, region);
  result[region.id] = r;
  if (r.kept.length < MIN_REALMS[region.id]) problems.push(`${region.id}: only ${r.kept.length} realms after filtering (expected >= ${MIN_REALMS[region.id]})`);
  const seen = new Map();
  for (const realm of r.kept) {
    for (const key of new Set([compact(realm.name), compact(realm.slug)])) {
      if (seen.has(key) && seen.get(key) !== realm.slug) problems.push(`${region.id}: "${realm.name}" and slug "${seen.get(key)}" collide on lookup key "${key}"`);
      seen.set(key, realm.slug);
    }
    if (!/^[\p{L}\p{M}\p{N}-]{1,64}$/u.test(realm.slug)) problems.push(`${region.id}: slug "${realm.slug}" would be rejected by the API validation`);
  }
}
if (problems.length) {
  console.error("Not writing data/realms.json:\n - " + problems.join("\n - "));
  process.exit(1);
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const out = {
  generatedAt: new Date().toISOString(),
  source: "Blizzard Game Data API /data/wow/realm/index (namespace dynamic-{region}); internal shard/instance/account realms removed",
  regions: Object.fromEntries(REGIONS.map((r) => [r.id, result[r.id].kept])),
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

console.log(`Wrote data/realms.json`);
for (const region of REGIONS) {
  const r = result[region.id];
  console.log(`  ${region.id.toUpperCase()}: ${r.kept.length} realms (dropped ${r.dropped.length} internal of ${r.all.length})`);
  if (previous?.regions?.[region.id]) {
    const before = new Set(previous.regions[region.id].map((x) => x.slug));
    const now = new Set(r.kept.map((x) => x.slug));
    const added = r.kept.filter((x) => !before.has(x.slug)).map((x) => x.name);
    const removed = previous.regions[region.id].filter((x) => !now.has(x.slug)).map((x) => x.name);
    if (added.length) console.log(`     + added:   ${added.join(", ")}`);
    if (removed.length) console.log(`     - removed: ${removed.join(", ")}`);
  }
}
// Anything left that still contains a digit deserves a human look: it is either
// a legitimate realm ("Area 52") or an internal one the filter should learn about.
for (const region of REGIONS) {
  const odd = result[region.id].kept.filter((r) => /\d/.test(r.name)).map((r) => r.name);
  if (odd.length) console.log(`  ${region.id.toUpperCase()} names containing digits (review): ${odd.join(", ")}`);
}
