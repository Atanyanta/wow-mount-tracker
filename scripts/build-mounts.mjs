// Compiles data/mounts.json from two sources, once, offline:
//  - Blizzard Game Data API: authoritative mount id + canonical name
//    (the id is the join key used later for owned-mount lookups against a
//    character's collections/mounts endpoint)
//  - warcraftmounts.com: per-mount "Introduced in" patch and "Source" text,
//    plus the Wowhead spell id and icon slug it already links to. This is a
//    one-time crawl cached to disk (.cache/warcraftmounts), not something the
//    live site repeats per request.
//
// Rerun with: npm run build:mounts

import * as cheerio from "cheerio";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "warcraftmounts");
const WOWHEAD_CACHE_DIR = path.join(process.cwd(), ".cache", "wowhead");
const OUT_FILE = path.join(process.cwd(), "data", "mounts.json");
const ICON_DIR = path.join(process.cwd(), "public", "icons");
const ICON_PLACEHOLDER = "/icons/_placeholder.svg";
const CONCURRENCY = 6;

// warcraftmounts' icon filename occasionally doesn't exist on Wowhead's CDN
// (stale/renamed). Wowhead's own mount/spell page always has the current
// icon in a <link rel="image_src"> tag, so fall back to scraping that.
async function fetchWowheadIconUrl(wowheadId) {
  if (!wowheadId) return null;
  try {
    const html = await fetchCachedFrom(
      WOWHEAD_CACHE_DIR,
      `https://www.wowhead.com/spell=${wowheadId}`,
      String(wowheadId)
    );
    const match = html.match(/<link rel="image_src" href="([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Downloads each mount's icon once from Wowhead's CDN and serves it from our
// own /public/icons instead - avoids ~1600 live hotlinks per page load and
// the ERR_INSUFFICIENT_RESOURCES flood that caused (see MountGrid.js).
// Skips re-downloading if the file is already on disk (rerun-friendly, same
// as the HTML cache).
async function downloadIcon(mount) {
  const localPath = path.join(ICON_DIR, `${mount.id}.jpg`);
  const publicPath = `/icons/${mount.id}.jpg`;
  try {
    await readFile(localPath);
    return publicPath;
  } catch {
    // not cached yet, fall through to fetch
  }

  const candidates = [mount.icon, await fetchWowheadIconUrl(mount.wowheadId)].filter(Boolean);
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFile(localPath, buffer);
      return publicPath;
    } catch (err) {
      console.warn(`  icon fetch failed for ${mount.name} (${url}): ${err.message}`);
    }
  }
  return ICON_PLACEHOLDER;
}

async function getBlizzardToken() {
  const clientId = process.env.BLIZZARD_CLIENT_ID;
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET are not set");
  }
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Blizzard token request failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function fetchBlizzardMountIndex(token) {
  const res = await fetch(
    "https://us.api.blizzard.com/data/wow/mount/index?namespace=static-us&locale=en_US",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Blizzard mount index failed: ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const m of data.mounts) map.set(m.id, m.name);
  return map;
}

async function fetchCachedFrom(dir, url, cacheKey) {
  await mkdir(dir, { recursive: true });
  const cachePath = path.join(dir, `${cacheKey}.html`);
  try {
    return await readFile(cachePath, "utf-8");
  } catch {
    const res = await fetch(url, {
      headers: { "User-Agent": "wow-mount-tracker/1.0 (one-time personal build script)" },
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const html = await res.text();
    await writeFile(cachePath, html, "utf-8");
    return html;
  }
}

function fetchCached(url, cacheKey) {
  return fetchCachedFrom(CACHE_DIR, url, cacheKey);
}

async function fetchGalleryMountIds() {
  const html = await fetchCached("https://www.warcraftmounts.com/gallery.php", "_gallery");
  const ids = new Set();
  for (const match of html.matchAll(/mount\.php\?mountid=(\d+)/g)) {
    ids.add(Number(match[1]));
  }
  return [...ids].sort((a, b) => a - b);
}

// Buckets warcraftmounts.com's free-text "Source" field (e.g. "Achievement:
// Glory of the Uldir Raider" or "Dropped by Malygos in Eye of Eternity") into
// broad categories, since the raw text is one-subgroup-per-achievement
// granular. Ordered by specificity - first match wins. Tuned against the
// actual data (~1.3% fall through to "Other" as of the last full crawl);
// rerun the categorize-coverage check in the repo history if that grows.
const SOURCE_CATEGORY_RULES = [
  [/^Retired\b/i, "Retired"],
  [/Achievement:/i, "Achievement"],
  [/Brewfest|Hallow's End|Love is in the Air|Winter Veil|Lunar Festival|Midsummer|Children's Week|Noblegarden|Pilgrim's Bounty|Darkmoon Faire/i, "Holiday Event"],
  [/BlizzCon|Collector's Edition|Recruit A Friend|Twitch|Prime Gaming|Amazon|Promotion|Any Edition|Bundle|Diablo IV|Warcraft III|Upgrade Edition|Epic Pack|Heroic Pack/i, "Promotion"],
  [/Trading Post \(seasonal\)/i, "Trading Post"],
  [/Dropped by.*(\((Normal|Heroic|Mythic|LFR)[^)]*\)|\(\d+(,| ))/i, "Boss Drop"],
  [/Dropped by|Hatched from|Egg\b/i, "World Drop"],
  [/Crafted by|Profession:/i, "Profession"],
  [/Exalted with|Reputation|Paragon|Protoform Synthesis/i, "Reputation"],
  [/Black Market/i, "Black Market Auction House"],
  [/Trading Card/i, "Trading Card Game"],
  [/Battle\.net Shop|Store/i, "Store"],
  [/Trainer/i, "Class Trainer"],
  [/Covenant|Quest/i, "Quest"],
  [/Honor|Conquest|PvP|Battleground|Arena/i, "PvP"],
  [/Garrison/i, "Garrison"],
  [/Treasure|Chest|Cache/i, "Treasure"],
  [/Cost:/i, "Vendor"],
  [/^[A-Z][\w'. -]+ in [A-Z]/, "World Drop"],
];

function categorizeSource(source) {
  if (!source) return null;
  for (const [pattern, category] of SOURCE_CATEGORY_RULES) {
    if (pattern.test(source)) return category;
  }
  return "Other";
}

function parseMountDetail(html, mountId) {
  const $ = cheerio.load(html);

  const name = $("#mountname").first().text().trim() || null;

  const iconSrc = $("img.icon").first().attr("src") || "";
  // zamimg's paths are case-sensitive lowercase; warcraftmounts sometimes
  // has mixed-case filenames (e.g. "Ability_Mount_TyraelMount.png").
  const iconSlug = path.basename(iconSrc, path.extname(iconSrc)).toLowerCase() || null;
  const iconUrl = iconSlug
    ? `https://wow.zamimg.com/images/wow/icons/large/${iconSlug}.jpg`
    : null;

  // The site's markup wraps this <h3> in a <p>, which HTML5 parsing rules
  // implicitly close on encountering a block element — so the id ends up as
  // a loose text sibling of the <h3>, not inside any element we can select.
  let blizzardId = null;
  $("h3").each((_, el) => {
    const $el = $(el);
    if ($el.text().trim() === "Blizzard ID:") {
      const sibling = el.nextSibling;
      const idText = sibling && sibling.type === "text" ? sibling.data.trim() : "";
      const parsed = Number.parseInt(idText, 10);
      if (Number.isFinite(parsed)) blizzardId = parsed;
    }
  });

  let patch = null;
  $("h3").each((_, el) => {
    const $el = $(el);
    if ($el.text().trim() === "Introduced in:") {
      patch = $el.next(".mountdata").text().trim() || null;
    }
  });

  // Mounts obtainable multiple ways use "Source 1:", "Source 2:", etc.
  // instead of a single "Source:" heading.
  const sourceParts = [];
  $("h3").each((_, el) => {
    const $el = $(el);
    if (/^Source(\s*\d+)?:$/.test($el.text().trim())) {
      const text = $el.next("ul").text().replace(/\s+/g, " ").trim();
      if (text) sourceParts.push(text);
    }
  });
  const source = sourceParts.length ? sourceParts.join(" / ") : null;

  let wowheadId = null;
  const wowheadLinksText = $("#wowheadmountlinks a").first().attr("href") || "";
  const spellMatch = wowheadLinksText.match(/spell=(\d+)/);
  if (spellMatch) wowheadId = Number(spellMatch[1]);

  // Faction-restricted mounts have an extra <li><img class="factionrestrictionicon
  // alliance|horde" ...></li> inside "Riding Requirements:"; neutral mounts
  // just say "available to all eligible characters on your account."
  let faction = null;
  $("h3").each((_, el) => {
    const $el = $(el);
    if ($el.text().trim() === "Riding Requirements:") {
      const cls = $el.next("ul").find("img.factionrestrictionicon").attr("class") || "";
      if (/\balliance\b/i.test(cls)) faction = "alliance";
      else if (/\bhorde\b/i.test(cls)) faction = "horde";
    }
  });

  // "Notes:" - used as the description shown in the site's own cached
  // hover tooltip (see components/MountIcon.js), no live Wowhead call.
  let description = null;
  $("h3").each((_, el) => {
    const $el = $(el);
    if ($el.text().trim() === "Notes:") {
      description = $el.next(".mountdata").text().trim() || null;
    }
  });

  return { mountId, name, iconUrl, blizzardId, patch, source, wowheadId, description, faction };
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runOne));
  return results;
}

async function main() {
  console.log("Fetching Blizzard mount index...");
  const token = await getBlizzardToken();
  const blizzardMounts = await fetchBlizzardMountIndex(token);
  console.log(`Blizzard index: ${blizzardMounts.size} mounts`);

  console.log("Fetching warcraftmounts.com gallery...");
  const galleryIds = await fetchGalleryMountIds();
  console.log(`warcraftmounts.com gallery: ${galleryIds.length} mount pages`);

  console.log(`Crawling ${galleryIds.length} detail pages (concurrency ${CONCURRENCY})...`);
  let done = 0;
  const details = await runPool(
    galleryIds,
    async (mountId) => {
      try {
        const html = await fetchCached(
          `https://www.warcraftmounts.com/mount.php?mountid=${mountId}`,
          String(mountId)
        );
        const parsed = parseMountDetail(html, mountId);
        done++;
        if (done % 100 === 0) console.log(`  ${done}/${galleryIds.length}`);
        return parsed;
      } catch (err) {
        console.warn(`  failed mountId=${mountId}: ${err.message}`);
        return null;
      }
    },
    CONCURRENCY
  );

  const unmatchedWarcraftmounts = [];
  const seenBlizzardIds = new Set();
  const mounts = [];

  for (const d of details) {
    if (!d || !d.blizzardId) continue;
    const canonicalName = blizzardMounts.get(d.blizzardId);
    if (!canonicalName) {
      unmatchedWarcraftmounts.push(d);
      continue;
    }
    seenBlizzardIds.add(d.blizzardId);
    mounts.push({
      id: d.blizzardId,
      name: canonicalName,
      icon: d.iconUrl,
      wowheadId: d.wowheadId,
      patch: d.patch,
      source: d.source,
      sourceCategory: categorizeSource(d.source),
      description: d.description,
      faction: d.faction,
      wowheadCommentId: null,
    });
  }

  mounts.sort((a, b) => a.id - b.id);

  await mkdir(ICON_DIR, { recursive: true });
  console.log(`\nDownloading ${mounts.length} icons to ${ICON_DIR}...`);
  const localIcons = await runPool(
    mounts,
    (mount) => downloadIcon(mount),
    CONCURRENCY
  );
  mounts.forEach((mount, i) => {
    mount.icon = localIcons[i];
  });

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(mounts, null, 2), "utf-8");

  console.log(`\nWrote ${mounts.length} mounts to ${OUT_FILE}`);
  console.log(`Blizzard mounts with no warcraftmounts.com match: ${blizzardMounts.size - seenBlizzardIds.size}`);
  console.log(`warcraftmounts.com pages with a Blizzard ID not in Blizzard's index: ${unmatchedWarcraftmounts.length}`);
  console.log(`Mounts missing a patch: ${mounts.filter((m) => !m.patch).length}`);
  console.log(`Mounts missing a source: ${mounts.filter((m) => !m.source).length}`);
  console.log(`Mounts missing a wowhead id: ${mounts.filter((m) => !m.wowheadId).length}`);
  console.log(`Mounts with an uncategorized source ("Other"): ${mounts.filter((m) => m.sourceCategory === "Other").length}`);
  console.log(`Mounts using the placeholder icon (download failed): ${mounts.filter((m) => m.icon === ICON_PLACEHOLDER).length}`);
  console.log(`Mounts missing a description (Notes): ${mounts.filter((m) => !m.description).length}`);
  console.log(`Faction-restricted mounts: alliance=${mounts.filter((m) => m.faction === "alliance").length}, horde=${mounts.filter((m) => m.faction === "horde").length}, neutral=${mounts.filter((m) => !m.faction).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
