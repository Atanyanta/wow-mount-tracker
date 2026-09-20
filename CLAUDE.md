@AGENTS.md

# WoW Mount Collection Tracker

Next.js (App Router) app that displays every WoW mount as an icon, grouped by
expansion, then by the patch it was added in, then by a broad source
category (Achievement, Boss Drop, Vendor, ...) - with PvP and Trading Post
mounts pulled into their own standalone sections after all the expansions,
since people tend to browse those as a set regardless of patch. Click an
icon to go to its Wowhead page; hover shows a tooltip built entirely from
data cached at build time (no live external calls - see "Tooltip" below).
Search by character + realm + region to mark owned mounts (cached in
localStorage, manual rescan).

## Data pipeline

`data/mounts.json` is generated once by `npm run build:mounts`
(`scripts/build-mounts.mjs`) — not fetched live. It cross-references three
sources:

- **Blizzard Game Data API** (`/data/wow/mount/index`): authoritative mount
  id + canonical name. This id is the join key used later for owned-mount
  lookups against a character's `collections/mounts` endpoint. Blizzard's
  mount media/icon endpoint (`/data/wow/media/mount/{id}`) 404s — don't use
  it.
- **warcraftmounts.com**: crawled once per mount (`mount.php?mountid=N`,
  discovered via `gallery.php`), cached to `.cache/warcraftmounts/` so
  reruns are fast and don't re-hit the site. Each page's "Blizzard ID" field
  (a loose text node after a malformed `<h3>` — see the comment in
  `parseMountDetail`) is the join key back to Blizzard's id. Also supplies
  "Introduced in" (patch), "Source"/"Source N" (source text, joined when a
  mount has multiple, bucketed into `sourceCategory` via `SOURCE_CATEGORY_RULES`),
  "Notes" (used as the tooltip description), and the Wowhead spell id used
  for the click-through link and icon fallback.
- **Wowhead** (`wowhead.com/spell={id}`, cached to `.cache/wowhead/`):
  fallback icon source. warcraftmounts' icon filename is sometimes stale
  (doesn't exist on Wowhead's CDN); Wowhead's own page always has the
  current one in a `<link rel="image_src">` tag.

warcraftmounts also supplies `faction` ("alliance" | "horde" | null) - parsed
from an `<img class="factionrestrictionicon alliance|horde">` inside the
"Riding Requirements:" list (absent entirely for neutral mounts, which say
"available to all eligible characters on your account" instead). Used by
`app/page.js` to hide the opposing faction's mounts from the grid once a
character is scanned - see "Faction filtering" below.

Mount icons are downloaded once (primary: `wow.zamimg.com` using the slug
scraped from warcraftmounts, lowercased since zamimg's paths are
case-sensitive; fallback: the Wowhead page scrape above) and served locally
from `public/icons/<blizzardId>.jpg`. A mount whose download fails from
both sources (a couple of very new mounts not yet on Wowhead's CDN at all)
gets `public/icons/_placeholder.svg`. Self-hosting avoids ~1600 live
hotlinks per page load.

Rerun `npm run build:mounts` after a new WoW patch to pick up new mounts.
Expect a small number of mounts to be missing `patch`/`source`/`description`
(warcraftmounts genuinely doesn't have that data for some old/vanilla
mounts) — check the console summary the script prints after each run.

## Grouping (lib/groupMounts.js)

`groupMounts()` returns `{ expansions, crosscutSections }`:

- `expansions`: `[{ expansion, patches: [{ patch, sources: [{ source, mounts }] }] }]`,
  newest expansion first. Expansion is derived from the patch's major
  version number (`EXPANSIONS` lookup table - update it when a new
  expansion ships, same maintenance burden as the D3 scanner's
  `LATEST_SEASON`).
- `crosscutSections`: same shape but keyed by title ("PvP", "Trading Post" -
  see `CROSSCUTTING_CATEGORIES`) instead of expansion, and not further
  subgrouped by source (each section already *is* one category). Rendered
  after all expansions in `components/MountGrid.js`.

`components/MountGrid.js` renders each patch's source groups as side-by-side
bordered cards (`.source-card-row` / `.source-card` in `globals.css`) rather
than full-width stacked blocks - keeps small categories (e.g. one
achievement) from wasting vertical space.

## Tooltip (no live Wowhead widget)

Originally used Wowhead's official `power.js` tooltip widget. Removed it:
its `refreshLinks()` re-scans the page's entire `document.links` and
eagerly fetches tooltip data for every `wowhead.com` href at once - with
~1600 mounts that floods the browser (`ERR_INSUFFICIENT_RESOURCES`,
confirmed via a headless-browser check). Since the underlying mount data
barely changes, it's cheaper and simpler to cache tooltip content at build
time instead of fighting the widget's eager-fetch behavior.

`components/MountIcon.js` now renders a plain `<a href={wowheadUrl}>` (no
JS needed for the link at all) with a `.mount-tooltip` `<span>` shown via
pure CSS `:hover`/`:focus-visible` (see `globals.css`), populated from
`mount.description` (warcraftmounts' "Notes"), `source`, and `patch` -
all already in `data/mounts.json`, zero network calls on hover.

**Gotcha hit during development:** the tooltip must NOT be a descendant of
`.mount-icon-link` if that element has `overflow: hidden` (needed to clip
the icon `<img>` to its rounded box) - the overflow silently clips the
tooltip too, even though `display`/`visibility` report correctly (caught by
comparing `getComputedStyle` + `boundingBox()`, which both looked fine,
against an actual screenshot, which didn't show it). Fixed by moving the
`overflow: hidden` + border to an inner `.mount-icon-clip` wrapper around
just the `<img>`, leaving the outer link (the tooltip's positioning
ancestor) without a clip. If tooltips silently stop rendering again, check
for a re-introduced `overflow: hidden` between `.mount-icon-link` and
`.mount-tooltip`.

## Faction filtering

`app/api/collections/route.js` fetches the character's base profile
(`/profile/wow/character/{realm}/{name}`) alongside `collections/mounts`
to get `faction.type` ("ALLIANCE"/"HORDE"), lowercased and returned as
`faction` in the API response. Best-effort: if this second call fails, the
route still returns `ownedIds` with `faction: null` rather than failing
the whole lookup over a non-essential field.

`app/page.js` computes `relevantMounts` (mounts minus the opposing
faction's, once scanned) and shares it between `MountGrid` and
`CollectionSummary`, so both agree.

`CollectionSummary`'s `total`/`collected` also exclude mounts with
`sourceCategory === "Retired"` (no longer obtainable at all, e.g. Black
Qiraji Battle Tank) from both the numerator and denominator - counting them
would make 100% permanently unreachable for anyone who missed them, and
skew the percentage down for no actionable reason. If the player already
owns some of those, that's surfaced separately as `unobtainableOwned` (the
"+n unobtainable" in the display) rather than folded into `collected`.

Note: an earlier version also tried counting opposite-faction mounts
auto-granted by pairs like Stormpike Battle Charger/Frostwolf Howler (via a
manually-curated `lib/factionPairs.js`), to match the in-game Mount Journal
total exactly. Removed at the user's request - it made the count harder to
reason about than it was worth. If revisited, the underlying fact still
holds: Blizzard's public API does *not* include those auto-granted mirror
mounts, only the in-game client does.

## Secrets

`BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` in `.env.local` (gitignored,
never committed). All Blizzard API calls go through `lib/blizzard.js` —
keep it that way so a future rate limiter, or the account-wide Battle.net
login flow, has a single choke point to hook into.
