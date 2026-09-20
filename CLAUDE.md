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

## Usable count and rankings

- **Usable count**: the same `collections/mounts` response that gives owned
  mounts also has `is_useable` per entry (whether *this character* can use it -
  class/faction/riding restrictions; verified against the live API: 727 of 796
  for the test character). `app/api/collections/route.js` returns it as
  `usableIds`, `SearchBar` caches it, and `app/page.js` counts it over the same
  non-retired set as `collected` (matches missingmounts.com's "usable" figure).
  Scans cached before this existed have no `usableIds`; the summary says
  "rescan to see usable count" instead of auto-calling Blizzard.
- **World/region/server rankings are NOT computable here.** Blizzard's API has
  no leaderboard. missingmounts.com ranks only characters its own users have
  scanned ("indexed" - ~165k globally, so ranks shift as others scan); Data
  for Azeroth ranks characters uploaded through its own addon. Neither has a
  public API, and missingmounts sits behind Cloudflare, so the summary just
  links to the character's page (`/<region>/<realm-slug>/<name-slug>` - slugs
  via `lib/slug.js`). Don't fake a rank from locally scanned characters.

## Dailies tab (repeatable kills on a daily/weekly lockout)

A second view next to Collection (toggle in `app/page.js`) listing only the
mounts the scanned character is missing that drop from **dungeon bosses, raid
bosses and world bosses** on a daily/weekly lockout: raids (weekly), world
bosses (weekly), heroic and Mythic 0 dungeons (daily). Scope is deliberately
limited to those three types at the user's request - holiday bosses, Tanaan
elites, Theater of Pain, K'aresh swarm bosses, open-world rares (respawn timers,
no lockout) and weekly-quest chance rewards are all in the `excluded` list of
`data/farmables.json` (with mount ids) in case they're ever wanted back.

- **`data/farmables.json`** - hand-audited, grouped by cadence and type (raid,
  world boss, heroic dungeon, Mythic 0 dungeon), one entry
  per activity with its mounts (`id` + `name` + boss + difficulty) and a
  `confidence` (high/medium/low). `mounts.json` has no cadence field, only free
  text, and a regex over it misfiled ~30% (achievement/vendor mounts as kills,
  Return to Karazhan as heroic, etc.), so this is curated by hand, not derived.
- **`npm run check:farmables`** (`scripts/check-farmables.mjs`) - validates every
  id/name against `mounts.json` and regenerates `docs/farmables-review.md`, a
  grouped review sheet with each mount's raw source text beside it. Run it
  after editing the JSON; it exits 1 on any mismatch.
- **`lib/farmables.js`** - `resolveFarmables()`, pure (data passed in). A mount
  is owned if *any* mount with the same name is owned (faction twins like
  Grand Black War Mammoth 286/287); opposing-faction unowned mounts are
  dropped once the faction is known. No Blizzard calls - ownership comes from
  the already-cached scan.
- **`lib/resets.js`** - per-region reset schedule (`RESET_SCHEDULES`) and
  `getPeriodId` / `getNextReset`. "Done" checkmarks are stored per character
  in localStorage as `{ activityId: { cadence, period } }` and only count while
  `period` equals the current reset period id, so they expire at the region's
  server reset with no cleanup job (US = the scanned character's region:
  daily 15:00 UTC, weekly Tue 15:00 UTC; EU 04:00 UTC / Wed; KR+TW 23:00 UTC /
  Wed). Times are treated as **fixed UTC** - sources disagreed on DST; if a
  reset ever looks an hour off, fix `RESET_SCHEDULES` (verify in game with
  `/run print(C_DateAndTime.GetSecondsUntilDailyReset(), C_DateAndTime.GetSecondsUntilWeeklyReset())`).
- **`components/DailiesView.js`** - UI. `SearchBar` now passes
  `character: { region, realm, name }` up with each scan result so the tab
  knows which region's reset to use and where to store completion.

Midnight (12.x) entries are marked medium/low confidence: that content post-dates
the research and its lockouts weren't independently verified.

## Secrets

`BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` in `.env.local` (gitignored,
never committed). All Blizzard API calls go through `lib/blizzard.js` —
keep it that way so a future rate limiter, or the account-wide Battle.net
login flow, has a single choke point to hook into.
