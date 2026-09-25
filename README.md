# WoW Mount Collection Tracker

A personal Next.js app that shows every World of Warcraft mount as an icon,
grouped by expansion, patch and source, with PvP and Trading Post mounts in
their own sections. Scan a character to mark owned mounts and see collected /
usable counts, and use the **Quest Log** tab (styled after the in-game quest
log) to track missing mounts from dungeon, raid and world bosses on a daily or
weekly lockout.

Mount data, icons and tooltips are built ahead of time into `data/` and
`public/icons/`, so the page makes no external calls except the character scan.

## Setup

Needs Node 24 and a Blizzard API client ([develop.battle.net](https://develop.battle.net/access/clients)).

```
npm install
copy .env.example .env.local   # then fill in BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET
npm run dev                    # http://localhost:3000
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run lint` | ESLint |
| `npm run build:mounts` | Rebuilds `data/mounts.json` and `public/icons/` (Blizzard API + warcraftmounts.com + Wowhead). Run after a new WoW patch. |
| `npm run build:realms` | Rebuilds `data/realms.json` from Blizzard's realm index. Run when realms are added or renamed. |
| `npm run check:farmables` | Validates `data/farmables.json` and regenerates `docs/farmables-review.md` |

## Docs

- `CLAUDE.md` - architecture, data pipeline and known gotchas
- `docs/themes.md` - theme system
- `docs/qa-report.md` and `docs/qa/` - QA record and runnable test suites
