# Themes

The header has a theme switcher (round colour chips, right of the Collection /
Quest Log tabs). The choice is saved in localStorage and applied before first
paint. **Dark is the default** and is rendered server-side, so a first-time
visitor never sees an unthemed page. It does not follow the OS light/dark
setting.

Screenshots of every theme (Kurowastaken-Tichondrius) are in
`docs/style-previews/`.

## Themes

Dark (default), **Light** (warm parchment), Void, Alliance, Horde, and Azeroth
Gold (an extra kept from the first round of experiments - keep, rework or
delete).

Each theme in `lib/themes.js` is a bundle: one option on each of six axes
(`lib/styleOptions.js`):

| Axis | Options |
|---|---|
| **Palette** | Dark, Light, Void, Alliance, Horde, Azeroth Gold |
| **Headings** | Sans, Serif, Engraved caps |
| **Dividers** | Plain line, Gilded diamond, Banner rules, Ruled band |
| **Cards** | Flat, Framed corners, Plaque, Soft glow |
| **Collected mounts** | Green border, Dim missing, Check badge, Glow ring + badge, Silhouette missing |
| **Progress** | Text only, Counts beside headings, XP-style bars (count inside) |

**Every theme currently shares the same choices** - headings: engraved caps,
dividers: banner rules, cards: plaque, collected mounts: dim missing, progress:
XP-style bars - and differs only by palette (`SHARED` in `lib/themes.js`). To
make one theme diverge on an axis, give it its own value there.

### Palettes and the collected-mount highlight

The highlight on collected mounts (border + glow, and the check badge if that
option is used) is each palette's `--owned` colour, kept the same as the
theme's accent so it reads as part of the theme:

| Theme | Accent / collected highlight |
|---|---|
| Dark (default) | gold `#ffd100` |
| Light | brown-amber `#b06a12` on parchment |
| Void | purple `#b78cf7` |
| Alliance | gold `#d9b44a` (on blue - swap `--owned` for a blue if you'd rather) |
| Horde | ember orange `#e2692b` |
| Azeroth Gold *(extra)* | gold `#e8b923` |

Light replaced the earlier plain white/cream light theme with the parchment
palette (formerly a separate "Parchment" theme). A saved "parchment" theme
falls back to Dark.

## XP-style progress bars

With Progress = XP-style bars, every expansion/section heading gets a thick
inset bar with a glossy fill, 20 tick marks and the `owned / total` count
centred inside it, like the game's experience bar. The same bar (with
`owned / total · %`) sits under the overall summary line. Counts use the same
set as the summary total (opposing-faction and Retired mounts excluded) and
ignore the Collected/Uncollected filter. A fully collected section gets a
check and a highlighted border. "Counts beside headings" shows just the number
next to the heading instead.

## Collapsible sections

Every Collection section (each expansion, plus PvP and Trading Post) collapses
by clicking its heading (chevron on the left). A collapsed section keeps its
heading and XP bar as a one-line progress summary, so **Collapse all** gives a
compact dashboard of every expansion. **Expand all** / **Collapse all** are in
the filter bar and act on the sections currently on screen. Collapsed sections
aren't rendered at all, which also keeps the page light. State is saved in
localStorage (`wow-mount-tracker:collapsed`, by section title) and works the
same in every theme. Sections are expanded by default. The Quest Log's
categories collapse the same way (with in-game style [+]/[-] boxes and their
own Expand all / Collapse all), saved separately in
`wow-mount-tracker:quest-log-collapsed`.

## Filter bar and toggles

The filter bar uses two small reusable controls, styled entirely from the
palette variables so every theme restyles them automatically (same inset track
and glossy accent fill as the XP bars):

- `components/SegmentedControl.js` - All / Collected / Uncollected (real radio
  inputs; Collected/Uncollected are disabled until a character is scanned).
- `components/Toggle.js` - on/off switch (real checkbox, `role="switch"`), used
  for "Show retired" and for the two Quest Log options ("Hide completed",
  "Include collected mounts").
- Expand all / Collapse all buttons, with chevrons that match the section
  headings (down = expanded, right = collapsed).

## Deciding what goes in each theme

The **Customize** panel (`components/StylePicker.js`) is design-time
scaffolding that layers individual axis options on top of the active theme
(dashed outline = the theme's own choice) without touching the bundle. It is
**hidden by default**. To bring it back, add this to `.env.local` and restart
`npm run dev`:

```
NEXT_PUBLIC_THEME_CUSTOMIZER=1
```

While it's off, any overrides saved from an earlier session are ignored, so a
hidden override can't silently change a theme. When a combination looks right,
copy the "Current mix" line (or just read the axis values) into `picks` in
`lib/themes.js`.

## Common changes

- **Change what a theme looks like:** edit its `picks` in `lib/themes.js`.
- **Add a theme:** add an entry to `THEMES` (with a `swatch` of
  `[background, accent]` for its chip). Reuse an existing palette, or add a new
  palette id to `STYLE_AXES` (palette options) and a
  `html[data-palette="<id>"]` block in `app/themes.css` defining the variables
  (copy an existing one; set `--accent`, `--owned`, `--on-owned`).
- **Remove a theme:** delete its entry. Anyone who had it saved falls back to
  Dark. Dark must stay first: it's the default.
- **Change an option's look:** edit its `html[data-<axis>="<option>"]` rules in
  `app/themes.css`. A `html[data-palette="<id>"]` block is also the place for
  anything specific to one theme (backgrounds, emblems, etc.).
- **Add an option to an axis:** add it to `STYLE_AXES`, then write its CSS.

## Behaviour notes

- "Dim missing", the dashed ring and "Silhouette missing" only apply to the
  Collection grid. The Quest Log lists missing mounts on purpose, so they stay
  full colour there. Collected mounts in the Quest Log still get the highlight.
- Nothing is dimmed before a character is scanned (`MountIcon` treats
  "no scan" as neutral, distinct from "scanned and missing").
- Always on, independent of theme: a "Collected" line in the tooltip of owned
  mounts, and "(collected)" in their aria-label.
- Both Quest Log panes follow the theme: palette colours for the list, the
  detail page (the same panel slab as the cards) and the accent-filled Done
  button, and the theme's heading font for the quest title and section
  headings (QUEST LOG block in `app/themes.css`). The daily/weekly and
  "unverified" pills have darker colours on the Light theme.

## Files

- `lib/themes.js` - theme registry (bundles, swatches, default, customizer flag).
- `lib/styleOptions.js` - the axes and their options.
- `lib/themeStore.js` - client state (active theme + overrides), localStorage,
  and applying `data-*` attributes to `<html>`; an external store so the
  switcher stays in sync (and across tabs).
- `lib/collapseStore.js` - which sections are collapsed (same store pattern).
- `components/ThemeSwitcher.js` - the header chips.
- `components/StylePicker.js` - the Customize panel (hidden; see above).
- `components/ThemeSync.js` - re-applies the theme after React mounts (dev
  Strict Mode remount resets `<html>` attributes).
- `components/InlineScript.js` - wrapper for the pre-paint theme script (see
  below).
- `components/FilterBar.js`, `SegmentedControl.js`, `Toggle.js` - the filter bar
  and its controls. `components/MountGrid.js` - collapsible `Section`s,
  per-section counts/bars.
- `app/layout.js` - server-renders the default theme's attributes on `<html>`
  and contains the inline head script that applies a saved theme before paint.
  It performs the same merge as `themeStore.js` (theme picks, then overrides);
  keep the two in step.
- `app/themes.css` - all palette/option CSS, keyed on `data-<axis>` attributes,
  plus the collapse, filter and toggle styling (which applies in every theme).

## Why the theme script goes through `InlineScript`

A bare `<script>` in the root layout works on first load, but React logs
"Encountered a script tag while rendering React component" (shown as a Next.js
error) whenever the layout is re-rendered on the client - which happens when
hot reload recovers from an error. `InlineScript` emits a real script on the
server and an inert `type="text/plain"` one on the client, per the Next.js
guide `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`.
Any new inline script in a layout should use it too.

## When the bundles are settled

Delete `StylePicker.js`, its import/usage in `layout.js`, the
`CUSTOMIZER_ENABLED` flag and override handling in `themes.js` /
`themeStore.js`, and the `.style-picker*` rules at the bottom of `themes.css`.
The switcher, stores and registry stay.
