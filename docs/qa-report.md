# QA report - WoW Mount Collection Tracker

Period: 2026-09-20 to 2026-09-21. Test character: **Kurowastaken-Tichondrius** (US, Alliance).
Scripts, raw results and screenshots referenced below are in [`docs/qa/`](qa/).

## 1. At a glance

| Area | Status | Checks |
|---|---|---|
| Data integrity, API, **realm list**, pure logic (Node) | Pass | 22 / 22 (+ 28 realm-library unit checks inside them) |
| Full UI in **Chrome** - dev server | Pass | 69 / 69 (91 / 91 with the Node checks) |
| Full UI in **Chrome** - production build | Pass | 91 / 91 |
| Full UI in **Firefox 156** - dev server | Pass | 48 / 48 |
| Full UI in **Firefox 156** - production build | Pass | 47 / 47 |
| Memory / leak test (client, server) | No leak found | 4 measured cycles + server stress (run before the realm feature; the combobox holds no timers or global listeners) |
| Security (secret exposure, input validation, `npm audit`) | Pass after 1 fix | 0 vulnerabilities |
| Bugs found | **9 found, 9 fixed** | see section 5 |

Unexpected console errors or failed network requests across every run: **0**.

## 2. Environment and method

- **Machine:** Windows 10, Node 24.15, Next.js 16.3.6 (Turbopack), React 19.3.0 (runs 1-17 used Next.js 16.3.4 / React 19.2.8).
- **Chrome:** a headless Chrome launched per run with a throwaway profile, driven over the DevTools protocol using **real mouse and keyboard events** (clicks, hovers, Tab, Enter, Space, arrows). It is not your visible Chrome window, and the Chrome extension was not used.
- **Firefox:** the installed Firefox 156, headless, throwaway profile, driven over **WebDriver BiDi** (its native automation protocol). Firefox is the browser you actually use, and it is where the reported hydration error came from.
- **Expected values are computed independently** from `data/mounts.json` and the live Blizzard API response, not copied from what the page shows. Example: the expected collected/total/usable/retired counts, the number of icons rendered, and the number of hidden opposing-faction mounts are all derived in the test from raw data.
- **Failures are simulated in the browser** by intercepting `/api/collections` (429, 500, 502, dropped connection, HTML instead of JSON), and storage is blocked by making `localStorage` throw.
- The dev server and a production build (`next start`, port 3100) were both tested.

## 3. What was tested

### 3.1 Node-side (15 checks here, plus 7 realm-list checks in 3.5; no browser)

| Group | What is verified |
|---|---|
| **Data** (4) | Mount ids unique; every mount has a name; every icon file exists in `public/icons`; faction is alliance/horde/null; patches parse; every `farmables.json` entry points at a real mount with a matching name. |
| **API** (8) | Valid character returns 200 with `ownedIds`, `usableIds` (subset of owned) and `faction`; missing params 400; bad region 400; unknown character 404 with a message; case/space normalisation; **hostile input rejected with 400** (`?`, `/`, `#`, `../`, 3,000-character name); **legitimate international names still pass** (Korean realm and name, accents, apostrophes, spaces -> 404 "not found", not 400); POST returns 405 and an unknown page 404. |
| **Logic** (3) | `resets.js`: for all 4 regions x 21 dates, the next daily/weekly reset lands on the configured UTC hour/weekday, is within one period, and the period id increments exactly at the boundary and not before. `farmables.js`: no scan means nothing owned; owning everything means nothing remaining; opposing-faction mounts dropped. `groupMounts.js`: section titles match the sections actually built, and grouping never loses or duplicates a mount. |

### 3.2 Browser (52 checks here, plus 17 realm-combobox checks in 3.5; run in Chrome, with a Firefox subset)

| Group | What is verified |
|---|---|
| **Load** (4) | Title/heading; Dark is the default with the shared look; the Customize panel is hidden; the unscanned catalog shows every mount neutrally (no owned/unowned state); Collected/Uncollected radios arrive disabled in the server HTML; the theme is already applied at DOMContentLoaded (no flash). |
| **Search** (3) | Empty form gives a validation message; unknown character gives "not found" and stays unscanned; wrong region (EU) gives "not found". |
| **Scan** (3) | Scan by pressing Enter: status text, and summary numbers (collected / total, %, usable, retired not counted, unobtainable owned) all equal the independently computed values; icon counts (owned, unowned, total = relevant mounts); opposing-faction unowned mounts hidden while cross-faction owned mounts stay visible; cache written and restored after reload. |
| **Progress** (1) | Every section's XP bar label sums to the summary totals; each bar's fill percentage matches its label. |
| **Filters** (4) | Collected / Uncollected / All show exactly the right icons; section counts are unaffected by the filter (no "0 / n"); arrow keys move the radio selection; Show retired hides exactly the retired mounts. |
| **Collapse** (4) | Section toggle unmounts content and sets `aria-expanded`; the bar stays visible when collapsed; Enter and Space work; Collapse all / Expand all; state persists across a reload; Collapse all acts only on what is on screen. |
| **Icons** (4) | All links are Wowhead, `target=_blank`, `rel=noreferrer`; hover tooltip content, "Collected" line, on-screen position; **right-most icon's tooltip stays inside the viewport**; every image loads after scrolling the entire page (no broken icons, no 404s). |
| **Themes** (3) | All six chips apply their palette, persist across reload and are applied before hydration; WCAG contrast (4.5:1 body text, 3:1 headings) passes in every theme; bad saved values (old "parchment", invalid JSON, hidden overrides) fall back safely. |
| **Dailies** (4) | Summary, reset countdowns, cards; missing mounts are **not** dimmed there; "Include collected" adds owned rows; Done checkbox persists per character, decrements "left this reset", hides with Hide completed, survives reload, and **auto-expires when the stored period is one behind** (simulated reset). |
| **Accessibility** (1) | tablist/tab roles, radiogroup label, `role=switch`, no unlabelled buttons, no images without `alt`, `aria-expanded` on toggles, single `h1`, `lang=en`. |
| **Responsive** (3) | 320, 390 and 768 px: nothing extends past the viewport in Collection or Dailies; theme switcher visible. |
| **Perf** (1) | Load timing and element count recorded. |
| **Failures** (9) | With a scan loaded, a Blizzard 429, 500, 502, dropped connection, or non-JSON reply each show a clear message, **keep the previous results**, and the button recovers (not stuck on "Scanning..."); a normal rescan then succeeds; a 404 from a scanned state **clears** the old results and disables the filters again; a rapid double-click on Scan sends exactly one request; HTML typed into the name field renders as text and runs nothing. |
| **Storage blocked** (1) | With `localStorage` throwing a SecurityError: page loads, scan works, theme switching, collapsing and Dailies "Done" all work for the session, no errors. |
| **Keyboard** (1) | Tab order is Collection > Dailies > 6 theme chips > region > realm > name > Rescan > filter radios > Show retired > Expand all > Collapse all > section headings > icons; every stop has a visible focus indicator. |
| **Wide screens** (3) | 1920, 2560 and 3440 px: content stays centred at its max width, no overflow, tooltip flip still correct. |
| **Misc** (3) | No duplicate element ids; `aria-controls` targets exist; a theme/collapse change made in another tab (storage event) updates this tab; 25 rapid theme + collapse clicks leave state consistent. |

### 3.3 Firefox-specific (36 checks, plus 11 realm checks in 3.5)

Ran the scan-then-reload scenario four times (once after changing a filter, since Firefox restores that too), plus: catalog and filters, Show retired toggle, Collapse all and its persistence, all six themes and persistence before hydration, CSS features the design relies on (`color-mix`, `:has()`, `inset`, gradient `border-image`), a real pointer-move tooltip, and Dailies including "Done" persisting across reload. Screenshots of the Firefox rendering are in `qa/screenshots/`.

### 3.4 Other checks

| Check | Result |
|---|---|
| Production build (`npm run build`) | Compiles, 5/5 static pages, run after every code change |
| `npm run check:farmables` | 77 mounts / 57 activities valid |
| `npm run lint` | 0 errors; 1 pre-existing warning (`<img>` vs `next/image`) |
| Secret exposure | Blizzard secret found in **0** files of the browser bundle, `public/`, the server-rendered HTML, or any API response; `.env.local` is git-ignored and was never committed |
| `npm audit --omit=dev` | 0 vulnerabilities |

### 3.5 Realm list and type-ahead (added 2026-09-21)

The realm field used to be free text, so a typo or a differently punctuated realm name produced "Character not found". It is now a type-ahead over Blizzard's own realm list.

**How the list is made:** `npm run build:realms` (`scripts/build-realms.mjs`) reads Blizzard's realm index for US, EU, KR and TW once and writes `data/realms.json` (about 34 KB, committed). Nothing is fetched at page load. The script removes Blizzard's internal pseudo-realms (about 95 per region: `Account Realm`, `*-INST`, `Auxiliary`, `Arena Pass`, `RDB`, `GMSupport`, ...), refuses to write if any region looks truncated or two realms collide on a lookup key, and prints what was added or removed on each refresh. Result: **US 246, EU 267, KR 18, TW 27** realms. Each realm's real slug is stored, because slugs cannot be derived from names.

| Group | Checks | What is verified |
|---|---|---|
| **Data file** (Node) | 5 | Sane counts per region; unique, API-safe slugs; sorted; no internal realms leaked; well-known realms present (Tichondrius, Area 52, Illidan, Mal'Ganis, Zul'jin, Kel'Thuzad, Azjol-Nerub, Aggra (Português), Draenor, Azshara, Bleeding Hollow); list age (warns after 365 days). |
| **`lib/realms.js`** (Node, 28 unit checks) | 1 | Exact match by name or slug ignoring case/accents/punctuation/spaces (`kel thuzad`, `azjol nerub`, `area52`, `aggra portugues` all resolve); typos and other-region realms are *not* matched; search ranks prefix before substring and is alphabetical within a rank; Korean and Taiwanese realms are found by their English slug; "did you mean" suggestions (`Tichondrus` -> Tichondrius, `Illidn` -> Illidan); no crash on an unknown region; 2,000 searches in about 110 ms. |
| **API rules** (Node) | 2 | Unknown, typo'd or other-region realm gives 400 "Unknown realm"; a realm given by name resolves to the real slug (Azjol-Nerub, Aggra (Português)); a real Korean realm + name reaches Blizzard (200/404, never 400). |
| **Combobox** (Chrome, real keys and clicks) | 17 | ARIA combobox roles/`aria-expanded`/`aria-activedescendant`; opens with the whole region list; typing filters, best match first; no-match message and "did you mean" options; Down + Enter picks without submitting and a second Enter submits; Enter with partial text takes the top match; Escape closes without clearing; mouse click picks, and the exact realm shows the whole list with it marked; loose spelling snaps to the proper name on blur; accent-insensitive and substring search; Korean list and English-slug search; region switch drops a realm that is not in the new region but keeps one that is; invalid realm sends **no request**, shows a suggestion, and editing clears the error; the request carries `realm=azjolnerub`; saved searches restore in both the old (`Area 52`) and new (`area-52`) form; dropdown stays inside the viewport and on top at 1400 and 390 px; option text passes WCAG 4.5:1 in all six themes. |
| **Firefox** (BiDi, real key events) | 11 | Realm text restored after reload with no hydration error; opens on click with the full list; filter, ArrowDown, Enter, click-to-reopen, Escape; typo'd realm message and red field; region switch; Korean realm by English slug. |

## 4. Results history

| # | Run | Result | What happened |
|---|---|---|---|
| 1 | Chrome, first full run | 36 / 46 | 1 real bug (right-edge tooltip overflow) + **9** harness timeouts (an earlier progress note said 7; the correct number is 9). |
| 2 | Chrome | 37 / 46 | Tooltip fix verified. Timeouts diagnosed as a harness bug: it tried to return a hydrated DOM element by value, which fails on React's cyclic fiber links. |
| 3 | Chrome | 45 / 46 | Harness fixed. This exposed 1 real bug that the timeouts had hidden: filter bar overflows at phone width. |
| 4 | Chrome | 47 / 47 | Phone fix verified; 320 px case added. |
| 5 | Chrome, extended suite | 63 / 68 | 5 failures, all test-expectation errors (simulated network failure counted as unexpected; cleanup touched blocked storage; centring measured against a scrollbar-inclusive width). |
| 6 | Chrome, extended suite | **67 / 67** | After the 3 test fixes. |
| 7 | Chrome vs production build | **67 / 67** | |
| 8 | Firefox, first run | 30 / 36 | 6 false failures: my test counted an informational Next.js log line ("Hydrated") as a hydration error. Now counts only `error`/`warn`. |
| 9 | Firefox | **36 / 36** | |
| 10 | Firefox, **fix temporarily removed (A/B)** | 29 / 36 | The reported hydration error reproduced on **every** reload. See 5.1. File restored byte-for-byte. |
| 11 | Firefox vs production build | **36 / 36** | |
| 12 | Realm feature, first run (Chrome) | 87 / 91 | 1 real bug (list did not reopen on click) + 3 test errors (made-up Korean realm now correctly rejected; harness had no ArrowDown/Escape keys). |
| 13 | Chrome after fixes | 90 / 91 | Remaining failure was an assumption: a real Korean realm + name 테스트 returned **200** (that character exists), i.e. the Korean-script path works end to end. Assertion widened to "reaches Blizzard". |
| 14 | Chrome | **91 / 91** | |
| 15 | Firefox with realm block | 46 / 47 | Scripted `.focus()` does not dispatch focus events in an unfocused headless window; the check now clicks the field like a user. |
| 16 | Firefox / Chrome vs **production** | **47 / 47** and **91 / 91** | |
| 17 | 2026-09-24, Dailies Done button + Completed section (dev) | **91 / 91** and **48 / 48** | Checkbox replaced by Done/Undo buttons; Dailies test rewritten (card moves to Completed and back, Undo, hide, reload, reset expiry); Firefox gained an Undo check. |
| 18 | 2026-09-25, after upgrading to Next.js 16.3.6 / React 19.3.0 (dev; `npm run build` and lint also clean) | **91 / 91** and **48 / 48** | No regressions. The Firefox run removed its throwaway profile (an earlier interrupted run had left one behind, which is now git-ignored). |

## 5. Bugs found and fixed

| # | Severity | Bug | Cause | Fix | Verified by |
|---|---|---|---|---|---|
| 5.1 | High (your visible error) | "A tree hydrated but some attributes of the server rendered HTML didn't match" on the Collected / Uncollected radios | Firefox (and some extensions) alter form controls on freshly loaded HTML before React hydrates: it re-enabled the radios that had been enabled in the previous page view, and even restored the "Collected" selection you had clicked. | `autoComplete="off"` + `suppressHydrationWarning` on the inputs, plus a layout effect that re-syncs `disabled` after hydration (`SegmentedControl.js`, `Toggle.js`). | **A/B in Firefox:** fix removed = the exact error on all 4 reloads and altered DOM; fix in place = 0 errors and the DOM matches. Also simulated in Chrome by removing `disabled` before hydration. |
| 5.2 | Medium | React error "Encountered a script tag while rendering React component" | The theme script in `layout.js` was a raw `<script>`; React rejects those whenever the layout re-renders on the client (hot-reload recovery). | `components/InlineScript.js`, per the Next.js "preventing flash" guide. | Forced a runtime error and recovery; error gone. |
| 5.3 | Medium | Tooltips cut off for icons in the right ~250 px of the window (up to 128 px off-screen) | Tooltip was always left-anchored to the icon. | `lib/tooltipFlip.js`: one delegated handler flips the tooltip to right-aligned near the edge. | Right-most-icon test at 1400, 1920, 2560, 3440 px; screenshot. |
| 5.4 | Medium | Filter bar wider than the screen at phone width (right edge at 398 px in a 390 px window) | "Show" label + three segments did not fit. | Wrap and tighten the segments at <= 520 px. | 320 / 390 / 768 px overflow tests; screenshot. |
| 5.5 | Low (local tool) | API forwarded unvalidated realm/name to a Blizzard URL path: a `?` in the name reached Blizzard (came back as a 502), a 3,000-character name was forwarded, `../` and `/` changed the upstream URL | Realm/name were only lowercased and space-replaced. | `SLUG_PATTERN` in the route: letters (any script), digits, hyphens, up to 64 chars, else 400. Legitimate Korean/accented/apostrophe/space names still work. | 5 hostile inputs return 400; 4 international inputs still 404 (valid, not found); the real character still 200. |
| 5.6 | Low | Dailies "WEEKLY" / "DAILY" pills nearly unreadable on the Light theme | Colours were tuned for dark backgrounds. | Darker variants for the Light palette. | Screenshot. |

Found while building and testing the realm type-ahead:

| # | Severity | Bug | Cause | Fix | Verified by |
|---|---|---|---|---|---|
| 5.7 | Medium (real characters unreachable) | Some realms could never be looked up: e.g. **Azjol-Nerub**, whose real Blizzard slug is `azjolnerub` (hyphen dropped), or Aggra (Português) | The app guessed the API slug from the typed name (`"Azjol-Nerub"` -> `azjol-nerub`), which does not match Blizzard's slugs. | The realm list stores Blizzard's real slug; the search bar and the API both resolve names to it. | Node + browser: the request carries `realm=azjolnerub`; API accepts the realm by name. |
| 5.8 | Low (UX) | An error such as *"Tichondrus isn't a US realm"* stayed on screen after the user fixed the field or changed region | The status message was only cleared on the next submit. | Editing region, realm or name clears an error (info messages stay). | Screenshots before/after; test "editing clears the error". |
| 5.9 | Medium (UX) | After picking a realm, clicking the still-focused field did not reopen the list | The list opened only on focus, and the field keeps focus after a pick. | Also open on click (`onClick`). | Caught by the test "clicking an option picks it... exact realm then shows the whole list"; passes in Chrome and Firefox. |

(Earlier sessions also fixed: cross-faction owned mounts being hidden from the grid, the search bar ignoring Enter, and a localStorage exception that could swallow a successful scan.)

## 6. Test-harness problems (not app bugs)

Listed so a future failure is not mistaken for one of these.

- Returning a hydrated DOM element over the DevTools protocol fails (cyclic React fiber references). Wrap conditions in `!!(...)`.
- Firefox's BiDi log includes an `info` line "Hydrated"; only `error`/`warn` count.
- `innerWidth` includes the scrollbar; use `clientWidth` when checking centring.
- A deliberately simulated network failure must be excluded from "unexpected network problems".
- .NET file APIs resolve relative paths against the process directory, not the PowerShell location; use absolute paths.
- A script-called `element.focus()` does not dispatch focus events in an unfocused headless Firefox window; click the element instead (as a user would).
- The key table in `qa.mjs` must contain every key a test presses (a missing ArrowDown/Escape entry crashed two tests).
- Test data that used to be valid can become invalid when validation gets stricter (a made-up Korean realm now, correctly, returns 400).

## 7. Performance and memory

| Measurement | Result |
|---|---|
| Client leak test (theme x48, collapse x12, single-section x30, filters x30, tab switches x12 with Dailies toggles, rescans x3; GC forced before each reading; 1 warm-up + 4 measured cycles) | JS heap flat at about 26 MB (variation of +/- 2 MB, no upward trend); DOM nodes **23,271 every cycle**; event listeners **3,648 every cycle**; document count constant. **No leak.** |
| All listeners, timers and store subscriptions | Each has a matching cleanup (checked in code and confirmed by the flat listener count). |
| Page size | 23,271 DOM nodes fully expanded (15,041 elements); about 60% of the icon-grid elements are the hidden per-icon tooltips. All sections collapsed: 598 nodes. Icon files total 2.9 MB (1,600 files, about 1.9 KB each). |
| Load time, dev | DOMContentLoaded ~500 ms, load ~1.1 s |
| Load time, production | DOMContentLoaded ~120 ms, load ~480 ms |
| Dev server memory (5 rounds of 40 page loads + 6 scans + 4 not-found) | 314 -> 503 -> 373 -> 643 -> 452 -> 504 MB: rises and falls, no upward trend |
| Production server memory (3 rounds of 60 loads + 6 scans) | About 660 MB, flat (658 / 661 / 664) - **not lighter than dev** |

The system running low on memory (which stopped the dev server twice) was not caused by the app: at the time Firefox held about 8 GB across 47 processes and WoW about 3 GB.

## 8. Observations - not bugs, not changed

- **Theme chips are six separate Tab stops.** They have `role=radio` inside a `radiogroup`, which normally means one Tab stop with arrow-key movement. Fine to use, slightly noisy for keyboard users.
- **Hidden tooltips are about 60% of the icon-grid DOM.** One shared tooltip (or rendering on hover) would roughly halve the page's node count. A memory/speed nicety, not a defect.
- **`localStorage` grows by a few KB per character scanned**, with no clean-up of old characters. Negligible for one user.
- **`lib/blizzard.js` has no request timeout**, and concurrent token fetches are not de-duplicated. A hung upstream would tie up a request indefinitely.
- **Dev-mode "Hydrated" info line** appears in the console; harmless, dev only.
- **On a phone the open realm list covers the character-name field** (the two stack vertically). Tapping elsewhere or picking a realm closes it; inherent to any dropdown at that width.
- **EU realm names are stored in English (en_GB)** while KR/TW are stored in Korean/Chinese. Every realm is also searchable by its English slug, so nobody is locked out, but an EU player who knows a realm only by a non-English local name would need its English spelling.

## 9. Not yet tested / ongoing

Roughly in order of value.

| Item | Why it matters / status |
|---|---|
| **Your review of the farmables data** (`docs/farmables-review.md`) | The Dailies lists are hand-curated; Midnight (12.x) rows are medium/low confidence and were never verified in game. Only a human with the game can confirm. |
| **Reset times vs the game** | Times are fixed UTC; the DST assumption was flagged as unverified. Verify with `/run print(C_DateAndTime.GetSecondsUntilDailyReset(), C_DateAndTime.GetSecondsUntilWeeklyReset())`. Logic is unit-tested; the *values* are not. |
| Real characters in **EU / KR / TW** | Only the US test character has a full scan. The realm lists and lookups for the other regions are tested, and the API reached real characters there (a character named "test" on Azjol-Nerub and 테스트 on Azshara both returned 200), but a full collection scan and the region's reset schedule were not verified. |
| **Keeping the realm list current** | `data/realms.json` is a snapshot from 2026-09-21. Re-run `npm run build:realms` when Blizzard adds or renames a realm; the script prints the differences. The API rejects realms that are not in the list, so a brand-new realm is unusable until then. If Blizzard adds a new kind of internal realm the filter does not know, the script's "names containing digits" review line and the QA test "no internal realms leaked" are the tripwires; check both after a refresh. |
| Realm list scope | Retail realms only (`dynamic-{region}`); Classic/Anniversary realms are separate namespaces and are not offered. Connected realms are listed individually, as Blizzard does. |
| A real Blizzard **429** | Simulated in the browser; not provoked for real. |
| **Safari / WebKit**, real **touch devices** | No Apple hardware or devices available. Chrome and Firefox are covered. |
| **Screen reader** pass (NVDA/Narrator) | Roles, labels and keyboard order are verified programmatically; actual announcement quality is not. |
| **Visual regression baseline** | Screenshots are reviewed by eye, not compared automatically. |
| Automated accessibility audit (axe) | Contrast is checked for body text and headings only, not every UI element. |
| **Data pipeline** (`npm run build:mounts`) | Not re-run; depends on warcraftmounts.com and Wowhead markup staying the same. Re-run after each WoW patch. |
| The hidden **Customize panel** | Kept in the code but hidden, so not covered by these runs. |
| **Long-running soak** (hours) in a real browser | Leak test covers thousands of interactions, not elapsed time. |
| A genuine **second browser tab** | Cross-tab sync is tested by dispatching the storage event, not with two live tabs. |

## 10. Re-running the tests

Scripts live in `docs/qa/` and use absolute paths for this machine (`ROOT` at the top of `qa.mjs`, and the Chrome/Firefox install paths). They write temporary profiles, screenshots and result files next to themselves and clean up the profiles.

```
npm run dev                                # server on :3000
node docs/qa/qa.mjs                        # Node + Chrome suite (91 checks; runs realms-unit.mjs too)
node docs/qa/ff.mjs                        # Firefox suite (48 checks)
node docs/qa/realms-unit.mjs               # realm lookup/search library on its own (28 checks)
node docs/qa/leak.mjs 4                    # client memory-leak test, 4 measured cycles
npm run build:realms                       # refresh data/realms.json from Blizzard (needs .env.local)

# against a production build
npm run build
node node_modules/next/dist/bin/next start -p 3100     # in another terminal
$env:QA_BASE = 'http://localhost:3100'; node docs/qa/qa.mjs; node docs/qa/ff.mjs
```

Requirements: Node 22+ (built-in `WebSocket`), Chrome and Firefox installed, and `.env.local` Blizzard credentials so the real-character scan works. **When stopping the production server, stop it by its process id** - matching on the command line can also match the dev server.

## 11. Suggested manual review

Things only a person can judge:

1. Flip through every theme and both tabs and confirm you like the look (`docs/style-previews/`, `docs/qa/screenshots/`).
2. Review `docs/farmables-review.md`, especially Midnight rows.
3. Check the reset countdown against the in-game command above.
4. Try your real browser (Firefox) and confirm the hydration error is gone after a hard refresh (Ctrl+Shift+R).
5. Try the realm field on your own character and on a couple of other realms, in each theme: type a few letters, arrow keys + Enter, click an option, make a deliberate typo and press Scan. Screenshots: `qa/screenshots/realm-*.png`.
6. Skim `data/realms.json` for any realm in your region that should not be there (or is missing).
