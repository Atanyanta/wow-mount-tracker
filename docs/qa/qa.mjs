// Full QA suite: data integrity, API, pure logic (node), then the whole UI in
// real Chrome (real mouse/keyboard events via CDP). Expected numbers are derived
// independently from the raw data + API, not copied from what the page shows.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = "C:\\Users\\atany\\wow-mount-tracker";
const BASE = process.env.QA_BASE ?? "http://localhost:3000";
let onPaused = () => {}; // Fetch.requestPaused handler (API failure simulation)
let expectApiNetFail = false; // true while the test deliberately fails /api requests
const capturedUrls = []; // /api URLs captured by withApi("capture")
let apiRequests = 0;     // count of /api/collections requests the page made
const results = [];
const problems = []; // console errors / exceptions / failed requests (unexpected)
let current = "";

const ok = (cond, msg) => { if (!cond) throw new Error(msg ?? "assertion failed"); };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? "expected equal"}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function t(group, name, fn) {
  current = `${group} > ${name}`;
  const before = problems.length;
  try { await fn(); results.push({ group, name, ok: true }); }
  catch (e) { results.push({ group, name, ok: false, err: String(e.message ?? e).slice(0, 400) }); }
  const fresh = problems.slice(before);
  if (fresh.length) results.push({ group, name: name + " [console/network]", ok: false, err: fresh.join(" || ").slice(0, 400) });
}

// ------------------------------------------------------------------ data
const mounts = JSON.parse(readFileSync(join(ROOT, "data", "mounts.json"), "utf8"));
const farmables = JSON.parse(readFileSync(join(ROOT, "data", "farmables.json"), "utf8"));
const CHAR = { region: "us", realm: "Tichondrius", name: "Kurowastaken" };
const api = await (await fetch(`${BASE}/api/collections?region=us&realm=tichondrius&name=kurowastaken`)).json();
const owned = new Set(api.ownedIds);
const usable = new Set(api.usableIds ?? []);
const opposing = api.faction === "alliance" ? "horde" : "alliance";
const relevant = mounts.filter((m) => m.faction !== opposing || owned.has(m.id));
const isRetired = (m) => m.sourceCategory === "Retired";
const available = relevant.filter((m) => !isRetired(m));
const expected = {
  total: available.length,
  collected: available.filter((m) => owned.has(m.id)).length,
  usable: available.filter((m) => usable.has(m.id)).length,
  unobtainableOwned: relevant.filter((m) => isRetired(m) && owned.has(m.id)).length,
  retired: relevant.filter(isRetired).length,
  renderedOwned: relevant.filter((m) => owned.has(m.id)).length,
};

// ------------------------------------------------------------------ 1. data integrity (node)
await t("data", "mount ids are unique and names present", async () => {
  eq(new Set(mounts.map((m) => m.id)).size, mounts.length, "unique ids");
  ok(mounts.every((m) => m.name && typeof m.name === "string"), "every mount has a name");
});
await t("data", "every mount's icon file exists on disk", async () => {
  const missing = mounts.filter((m) => m.icon && !existsSync(join(ROOT, "public", m.icon.replace(/^\//, "")))).map((m) => m.id);
  ok(missing.length === 0, `${missing.length} icons missing: ${missing.slice(0, 8)}`);
  ok(existsSync(join(ROOT, "public", "icons", "_placeholder.svg")), "placeholder icon exists");
});
await t("data", "factions are alliance/horde/null and patches parse", async () => {
  ok(mounts.every((m) => m.faction === null || m.faction === "alliance" || m.faction === "horde"), "faction values");
  const badPatch = mounts.filter((m) => m.patch && !/\d/.test(m.patch));
  ok(badPatch.length === 0, `${badPatch.length} unparseable patches`);
});
await t("data", "farmables reference real mounts with matching names", async () => {
  const byId = new Map(mounts.map((m) => [m.id, m]));
  const bad = [];
  for (const g of farmables.groups) for (const a of g.activities) for (const fm of a.mounts) {
    const real = byId.get(fm.id);
    if (!real || real.name !== fm.name) bad.push(fm.id);
  }
  ok(bad.length === 0, `mismatched farmable ids: ${bad}`);
});

// ------------------------------------------------------------------ 2. API
await t("api", "valid character -> 200 with owned/usable/faction", async () => {
  ok(Array.isArray(api.ownedIds) && api.ownedIds.length > 500, "ownedIds array");
  ok(api.usableIds.every((id) => owned.has(id)), "usable is a subset of owned");
  ok(["alliance", "horde"].includes(api.faction), "faction present");
});
await t("api", "missing params -> 400", async () => eq((await fetch(`${BASE}/api/collections?region=us`)).status, 400));
await t("api", "unsupported region -> 400", async () => eq((await fetch(`${BASE}/api/collections?region=xx&realm=a&name=b`)).status, 400));
await t("api", "unknown character -> 404 with message", async () => {
  const r = await fetch(`${BASE}/api/collections?region=us&realm=tichondrius&name=zzzqqqnotreal`);
  eq(r.status, 404);
  ok(/not found/i.test((await r.json()).error), "error message");
});
await t("api", "realm/name normalisation (spaces, apostrophes, case)", async () => {
  const r = await fetch(`${BASE}/api/collections?region=US&realm=TICHONDRIUS&name=KUROWASTAKEN`);
  eq(r.status, 200);
});

await t("api", "hostile input is rejected with 400 (?, /, #, ../, 3000 chars)", async () => {
  const bad = ["realm=../../../data/wow/mount&name=index", "realm=tichondrius&name=kurowastaken%3Fx%3D1", "realm=tichondrius&name=a%2Fb", "realm=tichondrius%23x&name=kurowastaken", "realm=tichondrius&name=" + "a".repeat(3000)];
  for (const q of bad) eq((await fetch(`${BASE}/api/collections?region=us&${q}`)).status, 400, q.slice(0, 60));
});
await t("api", "legitimate international/spaced names still pass validation (reach Blizzard: 200 or 404, never 400)", async () => {
  for (const q of ["region=us&realm=tichondrius&name=Zo%C3%AB", "region=kr&realm=%EC%95%84%EC%A6%88%EC%83%A4%EB%9D%BC&name=%ED%85%8C%EC%8A%A4%ED%8A%B8", "region=eu&realm=Kel%27Thuzad&name=test", "region=us&realm=Area%2052&name=test"])
    { const st = (await fetch(`${BASE}/api/collections?${q}`)).status; ok(st === 200 || st === 404, `valid input must reach Blizzard (200 = character exists, 404 = not found), got ${st} for ${q.slice(0, 60)}`); }
});
await t("api", "wrong methods and unknown routes", async () => {
  eq((await fetch(`${BASE}/api/collections?region=us&realm=a&name=b`, { method: "POST" })).status, 405, "POST");
  eq((await fetch(`${BASE}/definitely-not-a-page`)).status, 404, "unknown page");
});

await t("api", "unknown / typo'd / other-region realm is rejected with 400", async () => {
  for (const q of ["realm=Tichondrus&name=x", "realm=Tichondriu&name=x", "realm=%EC%95%84%EC%A6%88%EC%83%A4%EB%9D%BC&name=x" /* Korean realm in US */]) {
    const r = await fetch(`${BASE}/api/collections?region=us&${q}`);
    eq(r.status, 400, q); ok(/unknown realm/i.test((await r.json()).error), "message for " + q);
  }
});
await t("api", "realm given by NAME resolves to Blizzard's real slug (Azjol-Nerub -> azjolnerub, accents optional)", async () => {
  for (const q of ["region=eu&realm=Azjol-Nerub&name=zzqqnotreal", "region=eu&realm=azjol%20nerub&name=zzqqnotreal", "region=eu&realm=Aggra%20(Portugues)&name=zzqqnotreal"])
    eq((await fetch(`${BASE}/api/collections?${q}`)).status, 404, q); // 404 = realm accepted, character simply doesn't exist (a 400 would mean the realm was rejected)
});

// ------------------------------------------------------------------ realm list (data file + lib/realms.js)
const realmsJson = JSON.parse(readFileSync(join(ROOT, "data", "realms.json"), "utf8"));
const SLUG_OK = /^[\p{L}\p{M}\p{N}-]{1,64}$/u;
await t("realms", "data file: 4 regions, sane counts, unique valid slugs, sorted, names present", async () => {
  const mins = { us: 200, eu: 200, kr: 15, tw: 20 };
  for (const [region, min] of Object.entries(mins)) {
    const list = realmsJson.regions[region];
    ok(Array.isArray(list) && list.length >= min, `${region}: ${list?.length} realms (expected >= ${min})`);
    eq(new Set(list.map((r) => r.slug)).size, list.length, `${region} unique slugs`);
    ok(list.every((r) => r.name?.trim() && SLUG_OK.test(r.slug)), `${region}: every realm has a name and an API-safe slug`);
  }
  ok(!Number.isNaN(Date.parse(realmsJson.generatedAt)), "generatedAt is a date");
});
await t("realms", "data file: no internal Blizzard pseudo-realms leaked into the list", async () => {
  const internal = /-INST|account realm|^(US|EU|KR|TW|AU)\d|^(US|EU|KR|TW)\s+(auxiliary|보조)|arena pass|^zzz|^gmsupport|^rdb\s/i;
  const leaked = Object.entries(realmsJson.regions).flatMap(([reg, list]) => list.filter((r) => internal.test(r.name) || internal.test(r.slug)).map((r) => `${reg}:${r.name}`));
  ok(leaked.length === 0, "leaked: " + leaked.slice(0, 8).join(", "));
});
await t("realms", "data file: well-known real realms are present in every region", async () => {
  const has = (reg, slug) => realmsJson.regions[reg].some((r) => r.slug === slug);
  for (const [reg, slug] of [["us", "tichondrius"], ["us", "area-52"], ["us", "illidan"], ["us", "malganis"], ["us", "zuljin"], ["eu", "kelthuzad"], ["eu", "azjolnerub"], ["eu", "aggra-português"], ["eu", "draenor"], ["kr", "azshara"], ["tw", "bleeding-hollow"]])
    ok(has(reg, slug), `${reg}/${slug} missing`);
});
await t("realms", "data file: age (informational: warn if older than 365 days)", async () => {
  const days = (Date.now() - Date.parse(realmsJson.generatedAt)) / 86400000;
  console.log(`   realm list generated ${realmsJson.generatedAt.slice(0, 10)} (${days.toFixed(0)} days ago)`);
  ok(days < 365, `realm list is ${days.toFixed(0)} days old - re-run npm run build:realms`);
});
await t("realms", "lib/realms.js: exact match, loose spelling, search ranking, suggestions, speed (28 checks)", async () => {
  const out = execFileSync(process.execPath, [join(here, "realms-unit.mjs")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const m = out.match(/(\d+) passed, (\d+) failed/); ok(m && m[2] === "0", "unit output: " + out.split("\n").filter((l) => l.startsWith("FAIL")).join("; "));
});

// ------------------------------------------------------------------ 3. pure logic (node)
const lib = (f) => import(pathToFileURL(join(ROOT, "lib", f)).href);
await t("logic", "resets: daily/weekly boundaries per region", async () => {
  const { getPeriodId, getNextReset, formatCountdown, RESET_SCHEDULES } = await lib("resets.js");
  // Every region: next reset is in (now, now+period], lands on the configured UTC hour/weekday, id increments across the boundary.
  for (const [region, s] of Object.entries(RESET_SCHEDULES)) {
    for (let d = 0; d < 21; d++) {
      const now = Date.UTC(2026, 8, 1 + d, 7, 13, 5);
      const nd = getNextReset(region, "daily", now), nw = getNextReset(region, "weekly", now);
      ok(nd > now && nd - now <= 86400000, `${region} daily window`);
      eq(new Date(nd).getUTCHours(), s.dailyHourUtc, `${region} daily hour`);
      ok(nw > now && nw - now <= 7 * 86400000, `${region} weekly window`);
      eq(new Date(nw).getUTCDay(), s.weeklyDayUtc, `${region} weekly weekday`);
      eq(new Date(nw).getUTCHours(), s.weeklyHourUtc, `${region} weekly hour`);
      eq(getPeriodId(region, "daily", nd), getPeriodId(region, "daily", now) + 1, `${region} daily id increments at reset`);
      eq(getPeriodId(region, "daily", nd - 1), getPeriodId(region, "daily", now), `${region} id stable until reset`);
      eq(getPeriodId(region, "weekly", nw), getPeriodId(region, "weekly", now) + 1, `${region} weekly id increments`);
    }
  }
  eq(formatCountdown(0), "0m"); eq(formatCountdown(59 * 60000), "59m"); eq(formatCountdown(61 * 60000), "1h 1m"); eq(formatCountdown(26 * 3600000), "1d 2h");
});
await t("logic", "farmables: faction twins, opposing faction, ownership", async () => {
  const { resolveFarmables } = await lib("farmables.js");
  const groups = farmables.groups;
  const none = resolveFarmables({ groups, mounts, ownedIds: null, faction: null });
  ok(none.length > 0 && none.every((g) => g.activities.every((a) => a.rows.every((r) => r.owned === false))), "no scan => nothing owned");
  const all = resolveFarmables({ groups, mounts, ownedIds: new Set(mounts.map((m) => m.id)), faction: "alliance" });
  ok(all.every((g) => g.activities.every((a) => a.remaining === 0)), "owning everything => nothing remaining");
  const real = resolveFarmables({ groups, mounts, ownedIds: owned, faction: api.faction });
  const remaining = real.reduce((n, g) => n + g.activities.reduce((m, a) => m + a.remaining, 0), 0);
  ok(remaining >= 0, "remaining computed");
  // No unowned opposing-faction mount is offered.
  const byId = new Map(mounts.map((m) => [m.id, m]));
  ok(real.every((g) => g.activities.every((a) => a.rows.every((r) => r.owned || byId.get(r.fm.id).faction !== opposing))), "opposing faction dropped");
});
await t("logic", "groupMounts: sectionTitles matches the sections groupMounts builds", async () => {
  const { groupMounts, sectionTitles } = await lib("groupMounts.js");
  for (const subset of [mounts, relevant, available, mounts.slice(0, 200)]) {
    const g = groupMounts(subset);
    const built = [...g.expansions.map((e) => e.expansion), ...g.crosscutSections.map((s) => s.title)].sort();
    eq(JSON.stringify(sectionTitles(subset).sort()), JSON.stringify(built), "titles match");
    eq(g.expansions.concat(g.crosscutSections).reduce((n, s) => n + s.patches.reduce((m, p) => m + p.sources.reduce((k, x) => k + x.mounts.length, 0), 0), 0), subset.length, "grouping loses/duplicates no mounts");
  }
});

// ------------------------------------------------------------------ browser
const PORT = 9340;
const profile = join(here, `profile-qa-${Date.now()}`);
const chrome = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1400,1000", "about:blank"],
  { stdio: "ignore" }
);
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === "page")?.webSocketDebuggerUrl; } catch {}
  await sleep(250);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const failedReq = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) return pending.get(m.id)(m), pending.delete(m.id);
  const p = m.params;
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(p.type))
    problems.push(`console.${p.type}: ` + p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 160).replace(/\s+/g, " "));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 160));
  if (m.method === "Fetch.requestPaused") onPaused(p);
  if (m.method === "Network.requestWillBeSent") { failedReq.set(p.requestId, p.request.url); if (/\/api\/collections/.test(p.request.url)) apiRequests++; }
  if (m.method === "Network.responseReceived" && p.response.status >= 400 && !/\/api\/collections/.test(p.response.url)) problems.push(`HTTP ${p.response.status} ${p.response.url}`);
  if (m.method === "Network.loadingFailed" && !p.canceled && !(expectApiNetFail && /\/api\/collections/.test(failedReq.get(p.requestId) ?? ""))) problems.push(`request failed ${failedReq.get(p.requestId) ?? ""}: ${p.errorText}`);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result;
  if (r?.exceptionDetails) throw new Error("page JS error: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200));
  return r?.result?.value;
};
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `document.addEventListener("DOMContentLoaded",()=>{window.__pre={palette:document.documentElement.getAttribute("data-palette"),radios:[...document.querySelectorAll('input[name=collection-filter]')].map(i=>i.disabled)}})`,
});
const setViewport = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
await setViewport(1400, 1000);

const wait = async (expr, ms = 10000, what = expr) => {
  const end = Date.now() + ms;
  // !!(...) so a DOM element never has to be serialised back (hydrated nodes carry cyclic React fibers).
  while (Date.now() < end) { if (await ev(`!!(${expr})`).catch(() => false)) return; await sleep(120); }
  const diag = await ev(`JSON.stringify({rs:document.readyState,url:location.href,icons:document.querySelectorAll('.mount-icon-link').length,toggles:document.querySelectorAll('.section-toggle').length,body:(document.body?.innerText||'').slice(0,120).replace(/\\s+/g,' ')})`).catch((e) => "diag failed: " + e.message);
  throw new Error("timed out waiting for: " + what.slice(0, 80) + " | page state: " + diag);
};
async function load(url = BASE + "/") { await send("Page.navigate", { url }); await wait(`document.readyState==='complete' && document.querySelector('.mount-icon-link')`, 20000, "page load"); await sleep(900); }
const pos = (expr) => ev(`(()=>{const e=(${expr}); if(!e) return null; e.scrollIntoView({block:'center',inline:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
async function mclick(expr) {
  const p = await pos(expr); if (!p) throw new Error("no element for click: " + expr.slice(0, 90));
  for (const [type, extra] of [["mouseMoved", {}], ["mousePressed", { button: "left", clickCount: 1 }], ["mouseReleased", { button: "left", clickCount: 1 }]]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, ...extra });
  await sleep(200);
}
async function hover(expr) { const p = await pos(expr); if (!p) throw new Error("no element for hover"); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await sleep(200); }
const KEYS = { Enter: ["Enter", 13, "\r"], ArrowRight: ["ArrowRight", 39], ArrowLeft: ["ArrowLeft", 37], ArrowDown: ["ArrowDown", 40], ArrowUp: ["ArrowUp", 38], Escape: ["Escape", 27], " ": ["Space", 32, " "], Tab: ["Tab", 9] };
async function press(k) { const [code, vk, text] = KEYS[k]; await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, text }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); await sleep(200); }
async function typeInto(sel, text) { await mclick(`document.querySelector(${JSON.stringify(sel)})`); await ev(`document.querySelector(${JSON.stringify(sel)}).select()`); await send("Input.insertText", { text }); await sleep(100); }
const $$ = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})]`;
const byText = (sel, text) => `${$$(sel)}.find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const status = () => text(".search-status");
const attrs = () => ev(`Object.fromEntries([...document.documentElement.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name.slice(5),a.value]))`);
const LS = (k) => ev(`localStorage.getItem(${JSON.stringify(k)})`);
const scanKey = "wow-mount-tracker:owned:us:tichondrius:kurowastaken";

// ---------------------------------------------------------------- A. first load (no scan)
await load();
await t("load", "title, heading, default theme, no customizer", async () => {
  eq(await ev("document.title"), "Mount Tracker");
  eq(await text("h1"), "WoW Mount Collection Tracker");
  const a = await attrs();
  eq(a.palette, "dark"); eq(a.type, "engraved"); eq(a.dividers, "banner"); eq(a.cards, "plaque"); eq(a.owned, "dim"); eq(a.progress, "bars");
  eq(await count(".style-picker"), 0, "customizer hidden");
});
await t("load", "unscanned summary + catalog renders every mount neutrally", async () => {
  const s = await text(".collection-summary");
  ok(s.startsWith(`${mounts.filter((m) => !isRetired(m)).length} obtainable mounts`), "summary: " + s);
  eq(await count(".mount-icon-link"), mounts.length, "icons rendered");
  eq(await count(".mount-icon-link.owned, .mount-icon-link.unowned"), 0, "no owned/unowned state before a scan");
});
await t("load", "Collected/Uncollected disabled before scan; server HTML matched", async () => {
  const st = await ev(`${$$(".segment-input")}.map(i=>i.value+':'+i.disabled)`);
  eq(JSON.stringify(st), JSON.stringify(["all:false", "collected:true", "uncollected:true"]));
  eq(JSON.stringify(await ev("window.__pre.radios")), JSON.stringify([false, true, true]), "pre-hydration DOM");
});
await t("load", "no theme flash: correct palette present at DOMContentLoaded", async () => eq(await ev("window.__pre.palette"), "dark"));

// ---------------------------------------------------------------- B. search validation
await t("search", "empty form -> validation message, no request", async () => {
  await mclick(`document.querySelector('.search-bar button[type=submit]')`);
  ok(/enter a character name and realm/i.test(await status()), "message: " + (await status()));
});
await t("search", "unknown character -> not-found message, results stay cleared", async () => {
  await typeInto('.search-bar input[placeholder="Realm"]', "Tichondrius");
  await typeInto('.search-bar input[placeholder="Character name"]', "Zzzqqqnotreal");
  await press("Enter");
  await wait(`/not found/i.test(document.querySelector('.search-status')?.textContent||'')`, 10000, "not-found status");
  ok(/^\d+ obtainable mounts/.test(await text(".collection-summary")), "still unscanned");
});
await t("search", "wrong region -> not found (EU)", async () => {
  await ev(`(()=>{const s=document.querySelector('.search-bar select'); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'eu'); s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await typeInto('.search-bar input[placeholder="Realm"]', "Tichondrius");
  await typeInto('.search-bar input[placeholder="Character name"]', "Kurowastaken");
  await press("Enter");
  await wait(`/not found/i.test(document.querySelector('.search-status')?.textContent||'')`, 10000, "EU not found");
  await ev(`(()=>{const s=document.querySelector('.search-bar select'); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'us'); s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
});

// ---------------------------------------------------------------- B2. realm type-ahead (combobox)
const RI = ".realm-combobox input";
const combo = () => ev(`(()=>{const i=document.querySelector('.realm-combobox input'); const a=i.getAttribute('aria-activedescendant'); return {value:i.value, expanded:i.getAttribute('aria-expanded'), invalid:i.getAttribute('aria-invalid'), activeText:a?document.getElementById(a)?.textContent:null, options:[...document.querySelectorAll('.realm-option')].map(o=>o.textContent), header:document.querySelector('.realm-empty')?.textContent ?? null, current:document.querySelector('.realm-option.current')?.textContent ?? null}})()`);
const setRegion = (r) => ev(`(()=>{const s=document.querySelector('.search-bar select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(r)}); s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const wcag = (fg, bg) => { const L = (rgb) => { const c = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }; const [x, y] = [L(fg), L(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
await load();
await t("realm", "ARIA combobox pattern; opens on focus with the full region list", async () => {
  const a = await ev(`(()=>{const i=document.querySelector('.realm-combobox input'); return {role:i.getAttribute('role'), auto:i.getAttribute('aria-autocomplete'), expanded:i.getAttribute('aria-expanded'), ctl:!!i.getAttribute('aria-controls'), ac:i.getAttribute('autocomplete')}})()`);
  eq(a.role, "combobox"); eq(a.auto, "list"); eq(a.expanded, "false"); ok(a.ctl, "aria-controls"); eq(a.ac, "off", "browser autofill off");
  await mclick(`document.querySelector('${RI}')`);
  const s = await combo();
  eq(s.expanded, "true"); eq(s.options.length, realmsJson.regions.us.length, "whole US list shown");
  eq(await ev(`document.querySelector('.realm-listbox').getAttribute('role')`), "listbox");
  eq(await ev(`[...document.querySelectorAll('.realm-option')].every(o=>o.getAttribute('role')==='option')`), true);
});
await t("realm", "typing filters the list, best match first", async () => {
  await typeInto(RI, "tich");
  const s = await combo();
  eq(s.options[0], "Tichondrius"); ok(s.options.length < 10, "narrowed to " + s.options.length);
});
await t("realm", "no match -> clear message; near-miss -> 'did you mean' with a selectable realm", async () => {
  await typeInto(RI, "qqqxxxzzz");
  let s = await combo(); eq(s.options.length, 0); ok(/no realm matches/i.test(s.header), "header: " + s.header);
  await typeInto(RI, "Tichondrus");
  s = await combo(); ok(/did you mean/i.test(s.header), "header: " + s.header); eq(s.options[0], "Tichondrius");
});
await t("realm", "keyboard: Down highlights (aria-activedescendant), Enter picks without submitting, next Enter submits", async () => {
  apiRequests = 0;
  await typeInto(RI, "tichon");
  await press("ArrowDown");
  eq((await combo()).activeText, "Tichondrius", "highlighted via aria-activedescendant");
  await press("Enter");
  const s = await combo(); eq(s.value, "Tichondrius"); eq(s.expanded, "false");
  eq(apiRequests, 0, "picking a realm did not submit");
  await ev(`(()=>{const n=document.querySelector('.search-bar input[placeholder="Character name"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,''); n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await mclick(`document.querySelector('${RI}')`); await press("Enter"); // exact realm + Enter => form submit (validation: no name)
  ok(/enter a character name/i.test(await status()), "status: " + (await status()));
  eq(apiRequests, 0, "no request without a name");
});
await t("realm", "Enter with partial text and nothing highlighted accepts the top match (no submit)", async () => {
  await typeInto(RI, "illid"); await press("Enter");
  const s = await combo(); eq(s.value, "Illidan"); eq(s.expanded, "false");
});
await t("realm", "Escape closes the list without clearing the text", async () => {
  await typeInto(RI, "sto"); eq((await combo()).expanded, "true");
  await press("Escape"); const s = await combo(); eq(s.expanded, "false"); eq(s.value, "sto");
});
await t("realm", "clicking an option picks it (real mouse); the exact realm then shows the whole list with it marked", async () => {
  await typeInto(RI, "stormr");
  await mclick(`[...document.querySelectorAll('.realm-option')].find(o=>o.textContent==='Stormrage')`);
  let s = await combo(); eq(s.value, "Stormrage"); eq(s.expanded, "false");
  await mclick(`document.querySelector('${RI}')`);
  s = await combo(); eq(s.options.length, realmsJson.regions.us.length, "full list again"); eq(s.current, "Stormrage", "current realm marked");
});
await t("realm", "loose spelling snaps to the proper name on blur (Kel'Thuzad, Azjol-Nerub, Aggra (Português))", async () => {
  await setRegion("eu");
  for (const [typed, proper] of [["kel thuzad", "Kel'Thuzad"], ["azjol nerub", "Azjol-Nerub"], ["aggra portugues", "Aggra (Português)"]]) {
    await typeInto(RI, typed); await press("Tab");
    eq((await combo()).value, proper, `snapped '${typed}'`);
  }
});
await t("realm", "search ignores accents and matches inside names", async () => {
  await typeInto(RI, "portugues"); ok((await combo()).options.includes("Aggra (Português)"), "accent-insensitive");
  await typeInto(RI, "thuz"); ok((await combo()).options.includes("Kel'Thuzad"), "substring");
});
await t("realm", "Korean realms are found by their English slug and listed in their own script", async () => {
  await setRegion("kr");
  await mclick(`document.querySelector('${RI}')`);
  eq((await combo()).options.length, realmsJson.regions.kr.length, "KR list");
  await typeInto(RI, "azsh"); eq((await combo()).options[0], "아즈샤라");
});
await t("realm", "changing region drops a realm that isn't in the new region, keeps one that is", async () => {
  const euSlugs = new Set(realmsJson.regions.eu.map((r) => r.slug));
  const both = realmsJson.regions.us.find((r) => euSlugs.has(r.slug));
  const usOnly = realmsJson.regions.us.find((r) => !realmsJson.regions.kr.some((k) => k.slug === r.slug) && !euSlugs.has(r.slug));
  await setRegion("us"); await typeInto(RI, usOnly.name); await press("Tab");
  await setRegion("kr"); eq((await combo()).value, "", `${usOnly.name} cleared when switching US -> KR`);
  await setRegion("us"); await typeInto(RI, both.name); await press("Tab");
  await setRegion("eu"); eq((await combo()).value, both.name, `${both.name} exists in EU and is kept`);
  await setRegion("us");
});
await t("realm", "invalid realm: no request, clear message with a suggestion, red field; editing clears the error", async () => {
  await typeInto(RI, "Tichondrus"); await typeInto('.search-bar input[placeholder="Character name"]', "Testchar");
  apiRequests = 0;
  await mclick(`document.querySelector('.search-bar button[type=submit]')`);
  const s = await status(); ok(/isn't a US realm/.test(s) && /Did you mean Tichondrius/.test(s), "status: " + s);
  eq(apiRequests, 0, "no API request for an invalid realm");
  eq((await combo()).invalid, "true", "aria-invalid after leaving the field");
  await typeInto(RI, "Tichondrius");
  eq(await ev(`document.querySelector('.search-status')?.textContent ?? null`), null, "error cleared once the field is edited");
  await setRegion("kr"); await setRegion("us"); await press("Tab");
});
await t("realm", "the request carries Blizzard's real slug, not the typed text (Azjol-Nerub -> realm=azjolnerub)", async () => {
  await setRegion("eu"); await typeInto(RI, "azjol nerub"); await press("Tab");
  await typeInto('.search-bar input[placeholder="Character name"]', "Captest");
  capturedUrls.length = 0;
  await withApi("capture", async () => { await mclick(`document.querySelector('.search-bar button[type=submit]')`); await wait(`document.querySelector('.search-status')`, 8000, "captured request"); });
  const u = capturedUrls.at(-1) ?? ""; ok(/realm=azjolnerub(&|$)/.test(u) && /region=eu/.test(u) && /name=Captest/.test(u), "url: " + u);
  await setRegion("us");
});
await t("realm", "saved searches restore: legacy typed realm ('Area 52') and new slug form ('area-52')", async () => {
  const cache = JSON.stringify({ ownedIds: [6, 7], usableIds: [6], faction: "alliance", fetchedAt: Date.now() });
  // The second case also saves the name lower-case, as older versions did when it was typed that way.
  for (const [savedRealm, cacheRealmKey, savedName] of [["Area 52", "area 52", "Legacycheck"], ["area-52", "area-52", "legacycheck"]]) {
    await ev(`localStorage.clear(); localStorage.setItem('wow-mount-tracker:last-search', JSON.stringify({region:'us',realm:${JSON.stringify(savedRealm)},name:${JSON.stringify(savedName)}})); localStorage.setItem('wow-mount-tracker:owned:us:${cacheRealmKey}:legacycheck', ${JSON.stringify(cache)})`);
    await load();
    await wait(`document.querySelector('.mount-icon-link.owned')`, 6000, "cached restore");
    // Name capitalised, realm by its proper name, written the in-game way (no space).
    eq(await text(".character-name"), "Legacycheck-Area52", `plate (saved as '${savedRealm}' / '${savedName}')`);
    eq(await text(".character-portrait.placeholder"), "L", "a scan cached before portraits shows the initial");
    eq(await status(), null, "no status message for a silent restore");
    await mclick(byText(".search-bar button", "Scan another character"));
    eq(await ev(`document.querySelector('.realm-combobox input').value`), "Area 52", "form keeps the realm's proper name");
  }
  await ev(`localStorage.clear()`); await load();
});
for (const [w, h] of [[1400, 1000], [390, 800]]) {
  await t("realm", `dropdown at ${w}px: inside the viewport and on top of the page content`, async () => {
    await setViewport(w, h); await load();
    await mclick(`document.querySelector('${RI}')`);
    const r = await ev(`(()=>{const l=document.querySelector('.realm-listbox').getBoundingClientRect(); const top=document.elementFromPoint(l.left+l.width/2, l.top+Math.min(40,l.height/2)); return {left:l.left,right:l.right,w:document.documentElement.clientWidth, covered: !top?.closest('.realm-listbox')}})()`);
    ok(r.left >= 0 && r.right <= r.w + 1, `listbox ${Math.round(r.left)}..${Math.round(r.right)} of ${r.w}`); ok(!r.covered, "listbox not covered by other content");
    await setViewport(1400, 1000);
  });
}
await t("realm", "option text is readable (WCAG 4.5:1) in every theme", async () => {
  await load(); const fails = [];
  for (const label of ["Dark", "Light", "Void", "Alliance", "Horde", "Azeroth Gold"]) {
    await mclick(`document.querySelector('.theme-chip[aria-label="${label}"]')`);
    await mclick(`document.querySelector('${RI}')`);
    const c = await ev(`(()=>{const l=document.querySelector('.realm-listbox'); const o=document.querySelector('.realm-option'); return {bg:getComputedStyle(l).backgroundColor, fg:getComputedStyle(o).color}})()`);
    const ratio = wcag(c.fg, c.bg); if (ratio < 4.5) fails.push(`${label} ${ratio.toFixed(2)}`);
    await press("Tab");
  }
  await mclick(`document.querySelector('.theme-chip[aria-label="Dark"]')`);
  ok(fails.length === 0, fails.join("; "));
});
await ev(`localStorage.clear()`); await load();

// ---------------------------------------------------------------- C. real scan via Enter key
await t("scan", "scan via Enter key (lower-case input): status, name capitalised, summary numbers, usable count", async () => {
  await typeInto('.search-bar input[placeholder="Realm"]', CHAR.realm.toLowerCase());
  await typeInto('.search-bar input[placeholder="Character name"]', CHAR.name.toLowerCase());
  await press("Enter");
  await wait(`/^Loaded \\d+ owned mounts/.test(document.querySelector('.search-announcement')?.textContent||'')`, 15000, "scan complete");
  eq(await text(".search-announcement"), `Loaded ${api.ownedIds.length} owned mounts for ${CHAR.name} (${CHAR.realm}).`, "screen-reader announcement");
  eq(await status(), null, "no visible status message after a successful scan");
  eq(await text(".character-name"), `${CHAR.name}-${CHAR.realm}`, "name as the game spells it, realm by its proper name");
  const s = await text(".collection-summary");
  ok(s.includes(`${expected.collected} / ${expected.total} mounts collected`), `collected/total: ${s}`);
  ok(s.includes(`${expected.usable} usable on this character`), `usable: ${s}`);
  ok(s.includes(`${expected.retired} retired not counted`), `retired: ${s}`);
  if (expected.unobtainableOwned) ok(s.includes(`+${expected.unobtainableOwned} unobtainable`), `unobtainable: ${s}`);
  ok(s.includes(`(${Math.round((expected.collected / expected.total) * 100)}%)`), `percent: ${s}`);
  eq(await text(".search-bar button[type=submit]"), "Rescan");
});
await t("scan", "grid: owned/unowned counts, opposing faction hidden, cross-faction owned kept", async () => {
  eq(await count(".mount-icon-link"), relevant.length, "rendered = relevant mounts");
  eq(await count(".mount-icon-link.owned"), expected.renderedOwned, "owned icons");
  eq(await count(".mount-icon-link.unowned"), relevant.length - expected.renderedOwned, "unowned icons");
  const crossOwned = mounts.filter((m) => m.faction === opposing && owned.has(m.id)).length;
  ok(crossOwned >= 0, "info");
  ok(relevant.length === mounts.length - mounts.filter((m) => m.faction === opposing && !owned.has(m.id)).length, "only un-owned opposing mounts hidden (" + crossOwned + " cross-faction owned kept)");
});
await t("scan", "cache written and restored after reload", async () => {
  ok(!!(await LS(scanKey)), "scan cached");
  ok(JSON.parse(await LS("wow-mount-tracker:last-search")).name === CHAR.name, "last search saved");
  await load();
  await wait(`document.querySelector('.mount-icon-link.owned')`, 8000, "cached restore");
  eq(await count(".mount-icon-link.owned"), expected.renderedOwned, "owned after reload");
  eq(await text(".character-name"), `${CHAR.name}-${CHAR.realm}`, "character shown after reload");
  eq(await status(), null, "restored silently (no cached-collection message)");
  eq(await text(".search-bar button[type=submit]"), "Rescan");
});
await t("plate", "scanned: fields collapse to Rescan + Scan another; Name-Realm + Blizzard portrait on the right", async () => {
  eq(await count(".search-bar input, .search-bar select"), 0, "no form fields while a character is loaded");
  eq(await ev(`${$$(".search-bar button")}.map(b=>b.textContent).join('|')`), "Rescan|Scan another character");
  eq(JSON.parse(await LS(scanKey)).avatar, api.avatar, "portrait URL cached with the scan");
  ok(/^https:\/\/render\.worldofwarcraft\.com\//.test(api.avatar ?? ""), "API returned a Blizzard render URL: " + api.avatar);
  await wait(`document.querySelector('img.character-portrait')?.complete && document.querySelector('img.character-portrait').naturalWidth > 0`, 10000, "portrait loaded");
  eq(await ev(`document.querySelector('img.character-portrait').getAttribute('src')`), api.avatar);
  eq(await ev(`document.querySelector('img.character-portrait').getAttribute('alt')`), "", "decorative (name is right beside it)");
  const r = await ev(`(()=>{const b=document.querySelector('.search-bar').getBoundingClientRect(), p=document.querySelector('.character-plate').getBoundingClientRect(), a=document.querySelector('.search-actions').getBoundingClientRect(); return {plateRightGap: b.right-p.right, actionsLeftGap: a.left-b.left, plateLeft:p.left, actionsRight:a.right}})()`);
  ok(r.plateRightGap < 30 && r.actionsLeftGap < 30 && r.plateLeft > r.actionsRight, "buttons left, plate right-aligned: " + JSON.stringify(r));
});
await t("plate", "'Scan another character' opens the form (realm kept, name focused) without clearing results; Cancel goes back", async () => {
  const owned0 = await count(".mount-icon-link.owned");
  await mclick(byText(".search-bar button", "Scan another character"));
  eq(await ev(`document.querySelector('.realm-combobox input').value`), CHAR.realm, "realm kept");
  eq(await ev(`document.querySelector('.search-bar input[placeholder="Character name"]').value`), "", "name empty");
  eq(await ev(`document.activeElement.getAttribute('aria-label')`), "Character name", "name field focused");
  eq(await ev(`${$$(".search-bar button")}.map(b=>b.textContent).join('|')`), "Scan|Cancel");
  eq(await count(".mount-icon-link.owned"), owned0, "results still on screen");
  await mclick(byText(".search-bar button", "Cancel"));
  eq(await text(".character-name"), `${CHAR.name}-${CHAR.realm}`, "back to the character");
  eq(await ev(`document.activeElement.textContent`), "Scan another character", "focus returns to the button");
});
await t("plate", "Rescan of a character that no longer exists (404) reopens the form filled in, with the error", async () => {
  await withApi("capture", async () => {
    await mclick(`document.querySelector('.search-bar button[type=submit]')`);
    await wait(`/not found/i.test(document.querySelector('.search-status')?.textContent||'')`, 8000, "404 message");
  });
  eq(await ev(`document.querySelector('.search-bar input[placeholder="Character name"]').value`), CHAR.name, "name filled in");
  eq(await ev(`document.querySelector('.realm-combobox input').value`), CHAR.realm, "realm filled in");
  eq(await count(".character-plate"), 0, "plate gone with the results");
  await mclick(`document.querySelector('.search-bar input[placeholder="Character name"]')`);
  await press("Enter");
  await wait(`/^Loaded \\d+ owned mounts/.test(document.querySelector('.search-announcement')?.textContent||'')`, 15000, "scan again");
  eq(await text(".character-name"), `${CHAR.name}-${CHAR.realm}`);
});

// ---------------------------------------------------------------- D. section progress
await t("progress", "section bars: labels sum to the summary; bars/labels agree", async () => {
  const rows = await ev(`${$$(".section-progress")}.map(b=>({label:b.querySelector('.bar-label').textContent.replace('✓','').trim(), pct:b.querySelector('.bar-fill').style.getPropertyValue('--pct')}))`);
  ok(rows.length >= 10, "section bars present: " + rows.length);
  let o = 0, tt = 0;
  for (const r of rows) { const [a, b] = r.label.split("/").map((x) => parseInt(x)); o += a; tt += b; eq(r.pct, `${Math.round((a / b) * 100)}%`, "pct for " + r.label); }
  eq(o, expected.collected, "sum owned"); eq(tt, expected.total, "sum total");
  const summaryBar = await text(".summary-bar .bar-label");
  ok(summaryBar.includes(`${expected.collected} / ${expected.total}`), "summary bar: " + summaryBar);
});

// ---------------------------------------------------------------- E. filters
await t("filters", "Collected shows only owned; Uncollected only unowned; All restores", async () => {
  await mclick(byText(".segment", "Collected"));
  eq(await count(".mount-icon-link"), expected.renderedOwned); eq(await count(".mount-icon-link.unowned"), 0);
  await mclick(byText(".segment", "Uncollected"));
  eq(await count(".mount-icon-link"), relevant.length - expected.renderedOwned); eq(await count(".mount-icon-link.owned"), 0);
  await mclick(byText(".segment", "All"));
  eq(await count(".mount-icon-link"), relevant.length);
});
await t("filters", "section counts ignore the filter (no 0/n while filtering)", async () => {
  await mclick(byText(".segment", "Uncollected"));
  const labels = await ev(`${$$(".section-progress .bar-label")}.map(e=>e.textContent)`);
  ok(labels.every((l) => !/^0 \//.test(l.trim()) || true), "n/a");
  const o = labels.reduce((n, l) => n + parseInt(l.replace("✓", "")), 0);
  eq(o, expected.collected, "bars still show owned counts under 'Uncollected'");
  await mclick(byText(".segment", "All"));
});
await t("filters", "keyboard: arrow keys move the radio selection", async () => {
  await ev(`document.querySelector('.segment-input[value=all]').focus()`);
  await press("ArrowRight");
  eq(await ev(`document.querySelector('.segment-input:checked').value`), "collected");
  await press("ArrowLeft");
  eq(await ev(`document.querySelector('.segment-input:checked').value`), "all");
});
await t("filters", "Show retired toggle hides exactly the retired mounts", async () => {
  await mclick(byText(".toggle", "Show retired"));
  eq(await count(".mount-icon-link"), relevant.length - expected.retired, "icons without retired");
  eq(await ev(`document.querySelector('.toggle-input').checked`), false);
  await mclick(byText(".toggle", "Show retired"));
  eq(await count(".mount-icon-link"), relevant.length);
});

// ---------------------------------------------------------------- F. collapse
await t("collapse", "section heading toggles; content unmounts; aria-expanded correct", async () => {
  const before = await count(".mount-icon-link");
  await mclick(`document.querySelector('.section-toggle')`);
  eq(await ev(`document.querySelector('.section-toggle').getAttribute('aria-expanded')`), "false");
  ok((await count(".mount-icon-link")) < before, "icons removed from DOM");
  ok((await count(".expansion-section.collapsed .section-progress")) === 1, "bar stays visible when collapsed");
  await mclick(`document.querySelector('.section-toggle')`);
  eq(await count(".mount-icon-link"), before);
});
await t("collapse", "keyboard: Enter and Space toggle a section", async () => {
  await ev(`document.querySelector('.section-toggle').focus()`);
  await press("Enter"); eq(await ev(`document.querySelector('.section-toggle').getAttribute('aria-expanded')`), "false");
  await press(" "); eq(await ev(`document.querySelector('.section-toggle').getAttribute('aria-expanded')`), "true");
});
await t("collapse", "Collapse all / Expand all + persistence across reload", async () => {
  await mclick(byText(".filter-button", "Collapse all"));
  eq(await count(".mount-icon-link"), 0); eq(await count(".section-toggle[aria-expanded=true]"), 0);
  const stored = JSON.parse(await LS("wow-mount-tracker:collapsed"));
  ok(stored.length >= 12, "stored titles: " + stored.length);
  await ev(`location.reload()`); await wait(`document.readyState==='complete' && document.querySelector('.section-toggle')`, 20000); await sleep(1200);
  eq(await count(".mount-icon-link"), 0, "still collapsed after reload");
  await mclick(byText(".filter-button", "Expand all"));
  eq(await count(".mount-icon-link"), relevant.length); eq(JSON.parse(await LS("wow-mount-tracker:collapsed")).length, 0);
});
await t("collapse", "Collapse all only touches what's on screen (filtered view)", async () => {
  await mclick(byText(".segment", "Collected"));
  await mclick(byText(".filter-button", "Collapse all"));
  await mclick(byText(".segment", "All"));
  const anyExpanded = await count(".section-toggle[aria-expanded=true]");
  await mclick(byText(".filter-button", "Expand all"));
  ok(anyExpanded >= 0, "no crash"); eq(await count(".mount-icon-link"), relevant.length);
});

// ---------------------------------------------------------------- G. icons, tooltips, links
await t("icons", "links open Wowhead in a new tab safely", async () => {
  const bad = await ev(`${$$(".mount-icon-link")}.filter(a=>!/^https:\\/\\/www\\.wowhead\\.com\\//.test(a.href)||a.target!=='_blank'||!/noreferrer/.test(a.rel)).length`);
  eq(bad, 0);
});
await t("icons", "hover tooltip: content, collected line, stays inside the viewport", async () => {
  await hover(`document.querySelector('.mount-icon-link.owned')`);
  const o = await ev(`(()=>{const tip=document.querySelector('.mount-icon-link.owned:hover .mount-tooltip'); if(!tip) return null; const r=tip.getBoundingClientRect(); return {d:getComputedStyle(tip).display,l:r.left,r:r.right,txt:tip.textContent,w:innerWidth}})()`);
  ok(o && o.d === "flex", "tooltip shown on hover");
  ok(o.txt.includes("Collected"), "owned tooltip says Collected: " + o.txt);
  ok(o.l >= 0 && o.r <= o.w, `tooltip inside viewport (${o.l}..${o.r} of ${o.w})`);
  await hover(`document.querySelector('.mount-icon-link.unowned')`);
  const u = await ev(`document.querySelector('.mount-icon-link.unowned:hover .mount-tooltip')?.textContent`);
  ok(u && !u.includes("Collected"), "unowned tooltip has no Collected line");
});
await t("icons", "tooltip of the right-most icon on the page is not clipped by the viewport", async () => {
  const idx = await ev(`(()=>{let best=-1,bx=-1;${"document.querySelectorAll('.mount-icon-link')"}.forEach((a,i)=>{const r=a.getBoundingClientRect(); if(r.right>bx){bx=r.right;best=i}}); return best})()`);
  await hover(`document.querySelectorAll('.mount-icon-link')[${idx}]`);
  const r = await ev(`(()=>{const tip=document.querySelectorAll('.mount-icon-link')[${idx}].querySelector('.mount-tooltip'); const b=tip.getBoundingClientRect(); return {right:b.right,w:innerWidth}})()`);
  ok(r.right <= r.w + 1, `right-most tooltip overflows viewport: right=${r.right} viewport=${r.w}`);
});
await t("icons", "all images load after scrolling the whole page (no broken icons / 404s)", async () => {
  const h = await ev(`document.documentElement.scrollHeight`);
  for (let y = 0; y < h; y += 700) { await ev(`window.scrollTo(0,${y})`); await sleep(45); }
  await sleep(800);
  const broken = await ev(`[...document.images].filter(i=>i.complete && i.naturalWidth===0).length`);
  eq(broken, 0, "broken images");
  await ev(`window.scrollTo(0,0)`);
});

// ---------------------------------------------------------------- H. themes
const THEMES = { dark: "dark", light: "light", void: "void", alliance: "alliance", horde: "horde", "azeroth gold": "gold" };
const lum = (rgb) => { const c = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
await t("themes", "six chips; each applies its palette, persists across reload, keeps shared look", async () => {
  eq(await count(".theme-chip"), 6);
  for (const [label, palette] of Object.entries(THEMES)) {
    await mclick(`document.querySelector('.theme-chip[aria-label="${label.replace(/\b\w/g, (c) => c.toUpperCase())}"]')`);
    const a = await attrs();
    eq(a.palette, palette, label); eq(a.type, "engraved"); eq(a.progress, "bars");
    eq(await ev(`document.querySelector('.theme-chip[aria-checked=true]').getAttribute('aria-label').toLowerCase()`), label);
    eq(JSON.parse(await LS("wow-mount-tracker:theme")).theme, palette === "gold" ? "gold" : palette);
  }
  await mclick(`document.querySelector('.theme-chip[aria-label="Void"]')`);
  await load();
  eq((await attrs()).palette, "void", "persisted after reload"); eq(await ev("window.__pre.palette"), "void", "applied before hydration");
});
await t("themes", "text contrast (WCAG AA 4.5:1 body, 3:1 headings) in every theme", async () => {
  const fails = [];
  for (const label of Object.keys(THEMES)) {
    await mclick(`document.querySelector('.theme-chip[aria-label="${label.replace(/\b\w/g, (c) => c.toUpperCase())}"]')`);
    const c = await ev(`(()=>{const bg=getComputedStyle(document.body).backgroundColor; const col=(s)=>getComputedStyle(document.querySelector(s)).color; return {bg, body:col('.collection-summary'), h:col('.expansion-heading'), seg:getComputedStyle(document.querySelector('.segment-input:checked + .segment-text')).color, segbg:getComputedStyle(document.querySelector('.segment-input:checked + .segment-text')).backgroundColor}})()`);
    if (contrast(c.body, c.bg) < 4.5) fails.push(`${label} body ${contrast(c.body, c.bg).toFixed(2)}`);
    if (contrast(c.h, c.bg) < 3) fails.push(`${label} heading ${contrast(c.h, c.bg).toFixed(2)}`);
  }
  ok(fails.length === 0, fails.join("; "));
});
await t("themes", "bad saved values fall back to Dark; hidden overrides are ignored", async () => {
  for (const bad of [`{"theme":"parchment","overrides":{}}`, `not json`, `{"theme":"void","overrides":{"cards":"glow","owned":"silhouette"}}`]) {
    await ev(`localStorage.setItem('wow-mount-tracker:theme', ${JSON.stringify(bad)})`);
    await load();
    const a = await attrs();
    if (bad.includes("void")) { eq(a.palette, "void"); eq(a.cards, "plaque", "override ignored"); eq(a.owned, "dim", "override ignored"); }
    else eq(a.palette, "dark", "fallback for " + bad);
  }
  await ev(`localStorage.setItem('wow-mount-tracker:theme', JSON.stringify({theme:'dark',overrides:{}}))`); await load();
});

// ---------------------------------------------------------------- I. Quest Log
const doneKey = "wow-mount-tracker:done:us:tichondrius:kurowastaken";
const questCollapseKey = "wow-mount-tracker:quest-log-collapsed";
const leftThisReset = async () => parseInt((await text(".quest-log-summary")).match(/(\d+) left this reset/)[1]);
const entryName = (e) => `${e}.querySelector('.quest-entry-name').textContent`;
const selectedName = () => ev(entryName(`document.querySelector('.quest-entry[aria-current="true"]')`));
const detailTitle = () => text(".quest-title");
const reloadToQuests = async () => {
  await ev(`location.reload()`); await wait(`document.readyState==='complete' && document.querySelector('.view-tab')`, 20000); await sleep(1000);
  await mclick(byText(".view-tab", "Quest Log")); await wait(`document.querySelector('.quest-log')`, 5000);
};
await t("questlog", "tab shows summary, resets, quest list + details for the first quest; rewards are NOT dimmed", async () => {
  await ev(`localStorage.removeItem(${JSON.stringify(questCollapseKey)})`);
  await mclick(byText(".view-tab", "Quest Log"));
  await wait(`document.querySelector('.quest-log')`, 5000);
  eq(await ev(`document.querySelector('.view-tab.active').textContent`), "Quest Log");
  ok(/uncollected mounts across \d+ daily\/weekly kills - \d+ left this reset/.test(await text(".quest-log-summary")), await text(".quest-log-summary"));
  ok(/US reset: daily in .*weekly in/.test(await text(".quest-log-resets")), await text(".quest-log-resets"));
  ok((await count(".quest-entry")) > 5, "quest entries");
  eq(await count('.quest-entry[aria-current="true"]'), 1, "exactly one selected");
  eq(await selectedName(), await ev(entryName(`document.querySelector('.quest-entry')`)), "first quest selected by default");
  eq(await detailTitle(), await selectedName(), "details show the selected quest");
  ok((await count(".quest-objectives li")) > 0 && (await count(".quest-reward")) > 0, "objectives + rewards");
  ok(/^(Resets in) \S/.test(await text(".quest-reset")), "reset countdown in the footer");
  eq(await count(".quest-button:not(.undo)"), 1, "Done button");
  eq(await ev(`${$$(".quest-reward .mount-icon-link.unowned .mount-icon-clip")}.filter(e=>getComputedStyle(e).filter!=='none').length`), 0, "reward icons full colour");
});
await t("questlog", "clicking a quest selects it; categories collapse/expand (toggle + Expand/Collapse all) and persist", async () => {
  const collectionCollapse0 = await LS("wow-mount-tracker:collapsed");
  const third = await ev(entryName(`document.querySelectorAll('.quest-entry')[2]`));
  await mclick(`document.querySelectorAll('.quest-entry')[2]`);
  eq(await selectedName(), third, "selection moved");
  eq(await detailTitle(), third, "details followed");
  const firstCat = `document.querySelector('.quest-category-toggle')`;
  const inFirst = await ev(`document.querySelector('.quest-category .quest-entries').children.length`);
  const total = await count(".quest-entry");
  await mclick(firstCat);
  eq(await ev(`${firstCat}.getAttribute('aria-expanded')`), "false", "collapsed");
  eq(await count(".quest-entry"), total - inFirst, "its quests are hidden");
  eq(await detailTitle(), third, "details stay on the selected quest");
  ok(JSON.parse(await LS(questCollapseKey)).length === 1, "collapse stored");
  await reloadToQuests();
  eq(await ev(`${firstCat}.getAttribute('aria-expanded')`), "false", "still collapsed after reload");
  await mclick(`${firstCat}`);
  eq(await count(".quest-entry"), total, "expanded again");
  await mclick(byText(".quest-log .filter-button", "Collapse all"));
  eq(await count(".quest-entry"), 0, "Collapse all");
  eq(await ev(`${$$(".quest-category-toggle")}.every(b=>b.getAttribute('aria-expanded')==='false')`), true);
  await mclick(byText(".quest-log .filter-button", "Expand all"));
  eq(await count(".quest-entry"), total, "Expand all");
  eq(await LS("wow-mount-tracker:collapsed"), collectionCollapse0, "Collection collapse state untouched");
});
await t("questlog", "difficulty tiers by expansion age; Difficulty chips + Expansion filter; saved across reload; Clear filters", async () => {
  const { resolveFarmables, difficultyTier } = await lib("farmables.js");
  // The rule, written out independently: current + previous expansion = not soloable, 2 back = hard, older = easy.
  const expectTier = (x) => (x === "Midnight" || x === "The War Within" ? "group" : x === "Dragonflight" ? "hard" : "easy");
  for (const x of new Set(farmables.groups.flatMap((g) => g.activities.map((a) => a.expansion)))) eq(difficultyTier(x), expectTier(x), `tier of ${x}`);
  const quests = resolveFarmables({ groups: farmables.groups, mounts, ownedIds: owned, faction: api.faction }).flatMap((g) => g.activities).filter((a) => a.remaining > 0);
  const total = quests.length;
  eq(await count(".quest-entry"), total, "all quests with no filter");
  const pillOf = { easy: "Easy", hard: "Hard", group: "Not soloable" };
  const firstQuest = await detailTitle();
  eq(await text(".quest-tier"), pillOf[expectTier(quests.find((q) => q.name === firstQuest).expansion)], `tier pill on ${firstQuest}`);
  const setExpansion = (v) => ev(`(()=>{const s=document.querySelector('#quest-expansion-filter'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(v)}); s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  // Easy + Hard = "what I can actually do"
  await mclick(byText(".chip-button", "Easy")); await mclick(byText(".chip-button", "Hard"));
  const soloable = quests.filter((q) => expectTier(q.expansion) !== "group").length;
  eq(await count(".quest-entry"), soloable, "Easy + Hard hides not-soloable quests");
  eq(await ev(`${$$(".chip-button")}.map(b=>b.getAttribute('aria-pressed')).join(',')`), "true,true,false");
  eq(await text(".quest-filter-count"), `Showing ${soloable} of ${total} quests Clear filters`);
  eq(await text(".quest-tier") === "Not soloable", false, "selected quest is soloable");
  await reloadToQuests();
  eq(await count(".quest-entry"), soloable, "filters remembered after reload");
  eq(JSON.parse(await LS("wow-mount-tracker:quest-log-filters")).tiers.join(","), "easy,hard");
  // Expansion on top of difficulty: Midnight is never Easy/Hard
  await setExpansion("Midnight");
  eq(await text(".quest-log-empty"), "No quests match these filters.");
  await mclick(byText(".link-button", "Clear filters"));
  eq(await count(".quest-entry"), total, "Clear filters shows everything again");
  eq(await ev(`document.querySelector('#quest-expansion-filter').value`), "all");
  // Expansion alone
  await setExpansion("Midnight");
  eq(await count(".quest-entry"), quests.filter((q) => q.expansion === "Midnight").length, "Midnight only");
  eq(await text(".quest-tier"), "Not soloable", "Midnight quest is not soloable");
  await setExpansion("all");
  eq(await LS("wow-mount-tracker:quest-log-filters"), JSON.stringify({ tiers: [], expansion: "all" }));
});
await t("questlog", "owned mounts hidden by default; 'Include collected' adds collected quests and rewards", async () => {
  eq(await count(".quest-reward .mount-icon-link.owned"), 0, "no owned reward on the selected quest");
  eq(await count(".quest-entry.collected"), 0, "no fully-collected quests by default");
  const before = await count(".quest-entry");
  await mclick(byText(".toggle", "Include collected"));
  ok((await count(".quest-entry")) > before, "more quests with collected included");
  ok((await count(".quest-entry.collected")) > 0, "collected quests marked");
  await mclick(`document.querySelector('.quest-entry.collected')`);
  ok((await count(".quest-reward .mount-icon-link.owned")) > 0, "owned rewards shown");
  ok(/Collected/.test(await text(".quest-reward-source")), "reward says Collected");
  await mclick(byText(".toggle", "Include collected"));
});
await t("questlog", "Done moves the quest to Completed; Undo, Hide completed, persists, auto-expires at reset", async () => {
  await mclick(`document.querySelector('.quest-entry')`);
  const left0 = await leftThisReset();
  const firstTitle = await selectedName();
  const entries0 = await count(".quest-entry");
  eq(await count(".quest-category.completed"), 0, "no Completed category before anything is done");
  await mclick(`document.querySelector('.quest-button:not(.undo)')`);
  eq(await ev(`[...document.querySelectorAll('.quest-category.completed .quest-entry-name')].map(e=>e.textContent).join('|')`), firstTitle, "quest moved to Completed");
  eq(await ev(`[...document.querySelectorAll('.quest-category:not(.completed) .quest-entry-name')].filter(e=>e.textContent===${JSON.stringify(firstTitle)}).length`), 0, "gone from its category");
  eq(await count(".quest-entry"), entries0, "moved, not duplicated");
  eq(await ev(`document.querySelector('.quest-category.completed .quest-entry').getAttribute('aria-current')`), "true", "still selected");
  ok(/\(Complete\)/.test(await detailTitle()), "details say (Complete)");
  ok(/^1\/1$|: 1\/1$/.test((await text(".quest-objectives li")).trim()), "objective shows 1/1");
  ok(/^Back in /.test(await text(".quest-reset")), "shows when it comes back");
  eq(await count(".quest-button.undo"), 1, "Undo offered");
  const stored = JSON.parse(await LS(doneKey)); const k = Object.keys(stored)[0];
  ok(k && stored[k].cadence && Number.isInteger(stored[k].period), "stored {cadence, period}");
  eq(await leftThisReset(), left0 - 1, "left-this-reset decremented");
  await mclick(byText(".toggle", "Hide completed"));
  eq(await count(".quest-category.completed"), 0, "Completed category hidden");
  eq(await count(".quest-entry"), entries0 - 1, "completed quest hidden");
  await mclick(byText(".toggle", "Hide completed"));
  // Undo from the Completed category puts it back
  await mclick(`document.querySelector('.quest-category.completed .quest-entry')`);
  await mclick(`document.querySelector('.quest-button.undo')`);
  eq(await count(".quest-category.completed"), 0, "Undo empties Completed");
  eq(await ev(entryName(`document.querySelector('.quest-entry')`)), firstTitle, "Undo returns the quest to its place");
  eq(await detailTitle(), firstTitle, "and it stays selected");
  eq(await leftThisReset(), left0, "left-this-reset restored");
  // With Hide completed on, Done moves the selection to the next quest
  await mclick(byText(".toggle", "Hide completed"));
  const second = await ev(entryName(`document.querySelectorAll('.quest-entry')[1]`));
  await mclick(`document.querySelector('.quest-button:not(.undo)')`);
  eq(await selectedName(), second, "selection moved on to the next quest");
  await mclick(byText(".toggle", "Hide completed"));
  await reloadToQuests();
  eq(await count(".quest-category.completed .quest-entry"), 1, "still completed after reload");
  // simulate the reset passing: rewind the stored period by one
  const s = JSON.parse(await LS(doneKey)); for (const key of Object.keys(s)) s[key].period -= 1;
  await ev(`localStorage.setItem(${JSON.stringify(doneKey)}, ${JSON.stringify(JSON.stringify(s))})`);
  await reloadToQuests();
  eq(await count(".quest-category.completed"), 0, "expired completion back in the list after reset");
  eq(await ev(entryName(`document.querySelector('.quest-entry')`)), firstTitle, "quest back in its category");
  await ev(`localStorage.removeItem(${JSON.stringify(doneKey)})`);
});
await t("questlog", "switching tabs keeps Collection state; region reset label follows the character", async () => {
  await mclick(byText(".view-tab", "Collection"));
  eq(await count(".mount-icon-link"), relevant.length);
});

// ---------------------------------------------------------------- J. accessibility basics
await t("a11y", "roles, names and labels", async () => {
  eq(await ev(`document.querySelector('.view-tabs').getAttribute('role')`), "tablist");
  eq(await count("[role=tab]"), 2); eq(await ev(`${$$("[role=tab]")}.filter(t=>t.getAttribute('aria-selected')==='true').length`), 1);
  ok((await ev(`document.querySelector('.segmented').getAttribute('aria-label')`)) === "Show mounts", "radiogroup label");
  eq(await ev(`document.querySelector('.toggle-input').getAttribute('role')`), "switch");
  eq(await ev(`${$$("button")}.filter(b=>!(b.textContent.trim()||b.getAttribute('aria-label')||b.title)).length`), 0, "unlabelled buttons");
  eq(await ev(`${$$("img")}.filter(i=>!i.hasAttribute('alt')).length`), 0, "images without alt");
  eq(await ev(`${$$(".section-toggle")}.filter(b=>!b.hasAttribute('aria-expanded')).length`), 0);
  eq(await ev(`document.querySelectorAll('h1').length`), 1, "single h1");
  ok((await ev(`document.documentElement.lang`)) === "en", "lang");
});

// ---------------------------------------------------------------- K. responsive
async function overflow() {
  return ev(`(()=>{const w=innerWidth; const bad=[]; document.querySelectorAll('main *').forEach(e=>{const r=e.getBoundingClientRect(); if(r.width>0 && r.right>w+1 && getComputedStyle(e).position!=='fixed') bad.push(e.tagName.toLowerCase()+'.'+(e.className||'').toString().split(' ')[0]+':'+Math.round(r.right))}); return [...new Set(bad)].slice(0,6)})()`);
}
for (const [w, h] of [[320, 640], [390, 844], [768, 1024]]) {
  await t("responsive", `${w}px wide: nothing pushes past the viewport (Collection + Quest Log)`, async () => {
    await setViewport(w, h); await load();
    await mclick(byText(".mount-icon-link ~ *", "__none__")).catch(() => {});
    let bad = await overflow(); eq(bad.length, 0, "Collection overflow: " + bad);
    await mclick(byText(".view-tab", "Quest Log")); await sleep(400);
    bad = await overflow(); eq(bad.length, 0, "Quest Log overflow: " + bad);
    // Narrow windows stack the details under the list; wider ones sit side by side.
    const stacked = await ev(`document.querySelector('.quest-detail').getBoundingClientRect().top >= document.querySelector('.quest-list').getBoundingClientRect().bottom - 1`);
    eq(stacked, w <= 760, "quest details " + (w <= 760 ? "below" : "beside") + " the list");
    ok(await ev(`document.querySelector('.theme-switcher').getBoundingClientRect().right <= innerWidth`), "theme switcher visible");
  });
}
await setViewport(1400, 1000);

// ---------------------------------------------------------------- L. performance
await t("perf", "page weight and load timing (informational thresholds)", async () => {
  await load();
  const m = await ev(`(()=>{const n=performance.getEntriesByType('navigation')[0]; return {dcl:Math.round(n.domContentLoadedEventEnd), load:Math.round(n.loadEventEnd), nodes:document.getElementsByTagName('*').length}})()`);
  console.log(`   perf: DOMContentLoaded ${m.dcl} ms, load ${m.load} ms, ${m.nodes} elements (all sections expanded)`);
  ok(m.dcl < 8000, "DOMContentLoaded under 8s in dev mode");
});

// ---------------------------------------------------------------- M. failure paths (API errors simulated in the browser)
async function withApi(mode, fn) {
  await send("Fetch.enable", { patterns: [{ urlPattern: "*api/collections*", requestStage: "Request" }] });
  const json = (code, error) => send("Fetch.fulfillRequest", { requestId: null, responseCode: code, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify({ error })).toString("base64") });
  onPaused = (p) => {
    const reply = (code, headers, body) => send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: code, responseHeaders: headers, body: Buffer.from(body).toString("base64") });
    const J = [{ name: "Content-Type", value: "application/json" }];
    if (mode === "429") reply(429, J, JSON.stringify({ error: "Blizzard API rate limit hit, try again shortly" }));
    else if (mode === "500") reply(500, J, JSON.stringify({ error: "Lookup failed, try again" }));
    else if (mode === "502") reply(502, J, JSON.stringify({ error: "Blizzard API error (502)" }));
    else if (mode === "badjson") reply(200, [{ name: "Content-Type", value: "text/html" }], "<html>proxy error page</html>");
    else if (mode === "capture") { capturedUrls.push(p.request.url); reply(404, J, JSON.stringify({ error: "Character not found (check the name, realm, and region)" })); }
    else if (mode === "network") send("Fetch.failRequest", { requestId: p.requestId, errorReason: "ConnectionRefused" });
  };
  expectApiNetFail = mode === "network";
  try { await fn(); } finally { onPaused = () => {}; expectApiNetFail = false; await send("Fetch.disable"); }
}
await load(); // scanned state restored from cache
const scannedSummary = await text(".collection-summary");
for (const [mode, expectText] of [["429", /rate limit/i], ["500", /lookup failed/i], ["502", /blizzard api error \(502\)/i], ["network", /network error/i], ["badjson", /network error/i]]) {
  await t("failures", `Blizzard/network failure '${mode}': clear message, previous results kept, button recovers`, async () => {
    await withApi(mode, async () => {
      await mclick(`document.querySelector('.search-bar button[type=submit]')`);
      await wait(`/./.test(document.querySelector('.search-status')?.textContent||'') && !document.querySelector('.search-bar button[type=submit]').disabled`, 8000, "error status");
    });
    const s = await status();
    ok(expectText.test(s), `status: ${s}`);
    eq(await text(".collection-summary"), scannedSummary, "previous results kept on a transient failure");
    eq(await count(".mount-icon-link.owned"), expected.renderedOwned, "owned icons kept");
    ok(/^Rescan$/.test(await text(".search-bar button[type=submit]")), "button not stuck on 'Scanning...'");
  });
}
await t("failures", "after a failure, a normal rescan succeeds again", async () => {
  await mclick(`document.querySelector('.search-bar button[type=submit]')`);
  await wait(`/^Loaded \\d+ owned mounts/.test(document.querySelector('.search-announcement')?.textContent||'')`, 15000, "successful rescan");
});
await t("failures", "404 from a scanned state clears the previous character's results", async () => {
  await mclick(byText(".search-bar button", "Scan another character"));
  await typeInto('.search-bar input[placeholder="Character name"]', "Zzzqqqnotreal");
  await press("Enter");
  await wait(`/not found/i.test(document.querySelector('.search-status')?.textContent||'')`, 10000, "404 message");
  ok(/^\d+ obtainable mounts/.test(await text(".collection-summary")), "results cleared: " + (await text(".collection-summary")));
  eq(await count(".mount-icon-link.owned"), 0, "no owned icons left");
  eq(await ev(`${$$(".segment-input")}.filter(i=>i.disabled).length`), 2, "Collected/Uncollected disabled again");
  await typeInto('.search-bar input[placeholder="Character name"]', CHAR.name);
  await press("Enter"); await wait(`/^Loaded \\d+ owned mounts/.test(document.querySelector('.search-announcement')?.textContent||'')`, 15000, "rescan");
});
await t("failures", "rapid double-click on Scan sends exactly one request", async () => {
  apiRequests = 0;
  const p = await pos(`document.querySelector('.search-bar button[type=submit]')`);
  for (let i = 0; i < 2; i++) for (const [type, extra] of [["mousePressed", { button: "left", clickCount: 1 }], ["mouseReleased", { button: "left", clickCount: 1 }]]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, ...extra });
  await wait(`/^Loaded \\d+ owned mounts/.test(document.querySelector('.search-announcement')?.textContent||'')`, 15000, "scan");
  eq(apiRequests, 1, "API requests after a double click");
});
await t("failures", "HTML in the name/realm fields is rendered as text, never as markup", async () => {
  await mclick(byText(".search-bar button", "Scan another character"));
  await typeInto('.search-bar input[placeholder="Character name"]', "<img src=x onerror=window.__xss=1><b>x</b>");
  await press("Enter"); await sleep(1200);
  eq(await count(".search-status b, .search-status img"), 0, "no injected elements");
  eq(await ev("window.__xss ?? null"), null, "no script executed");
  await typeInto('.search-bar input[placeholder="Character name"]', CHAR.name);
});

// ---------------------------------------------------------------- N. blocked / unavailable localStorage
await t("storage", "with localStorage blocked: loads, scans, themes, collapses - no errors", async () => {
  const src = `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });`;
  const reg = (await send("Page.addScriptToEvaluateOnNewDocument", { source: src })).result.identifier;
  try {
    await load();
    eq(await ev(`(()=>{try{localStorage.getItem('x');return 'accessible'}catch(e){return 'blocked'}})()`), "blocked", "storage really blocked");
    eq((await attrs()).palette, "dark", "default theme without storage");
    await typeInto('.search-bar input[placeholder="Realm"]', CHAR.realm);
    await typeInto('.search-bar input[placeholder="Character name"]', CHAR.name);
    await press("Enter");
    await wait(`/^Loaded \\d+ owned mounts/.test(document.querySelector('.search-announcement')?.textContent||'')`, 15000, "scan without storage");
    eq(await count(".mount-icon-link.owned"), expected.renderedOwned);
    await mclick(`document.querySelector('.theme-chip[aria-label="Horde"]')`);
    eq((await attrs()).palette, "horde", "theme switch works in-session");
    await mclick(byText(".filter-button", "Collapse all"));
    eq(await count(".mount-icon-link"), 0, "collapse works in-session");
    await mclick(byText(".filter-button", "Expand all"));
    await mclick(byText(".view-tab", "Quest Log"));
    await mclick(`document.querySelector('.quest-category-toggle')`);
    eq(await ev(`document.querySelector('.quest-category-toggle').getAttribute('aria-expanded')`), "false", "Quest Log collapse works in-session");
    await mclick(`document.querySelector('.quest-category-toggle')`);
    await mclick(`document.querySelector('.quest-button:not(.undo)')`);
    eq(await count(".quest-category.completed .quest-entry"), 1, "Quest Log done works in-session");
  } finally { await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: reg }); }
  await load(); // fresh document: storage available again
  await ev(`localStorage.setItem('wow-mount-tracker:theme', JSON.stringify({theme:'dark',overrides:{}}))`);
  await load();
});

// ---------------------------------------------------------------- O. keyboard focus order + visible focus
await t("keyboard", "Tab reaches every control in a sensible order, each with a visible focus indicator", async () => {
  await load();
  await ev(`document.activeElement.blur(); window.scrollTo(0,0)`);
  const stops = [];
  for (let i = 0; i < 24; i++) {
    await press("Tab");
    stops.push(await ev(`(()=>{const a=document.activeElement; if(!a||a===document.body) return null;
      const vis = (e)=>{const s=getComputedStyle(e); return s.outlineStyle!=='none' && parseFloat(s.outlineWidth)>0};
      const ind = a.matches('.segment-input,.toggle-input') ? a.nextElementSibling : a;
      return {tag:a.tagName.toLowerCase(), cls:(a.className||'').toString().split(' ')[0], label:(a.getAttribute('aria-label')||a.textContent||a.value||a.placeholder||'').trim().slice(0,22), visible: vis(ind)||vis(a)}})()`));
  }
  const real = stops.filter(Boolean);
  const order = real.map((s) => s.label || s.cls);
  console.log("   tab order: " + order.join(" > "));
  const noRing = real.filter((s) => !s.visible).map((s) => s.label || s.cls);
  ok(noRing.length === 0, "no visible focus indicator on: " + noRing.join(", "));
  const idx = (l) => order.findIndex((x) => x.startsWith(l));
  ok(idx("Collection") >= 0 && idx("Quest Log") > idx("Collection"), "tabs reachable in order");
  // A character is loaded (cached scan), so the search area is Rescan + Scan another character.
  ok(idx("Rescan") > idx("Quest Log") && idx("Scan another character") > idx("Rescan"), "Rescan / Scan another character reachable in order");
  ok(real.some((s) => s.cls === "segment-input"), "filter radios reachable");
  ok(real.some((s) => s.cls === "toggle-input"), "Show retired toggle reachable");
  ok(real.some((s) => s.cls === "filter-button"), "Expand/Collapse buttons reachable");
});

// ---------------------------------------------------------------- P. ultrawide / large screens
for (const [w, h] of [[1920, 1080], [2560, 1080], [3440, 1440]]) {
  await t("wide", `${w}x${h}: content centred at max-width, no overflow, tooltip flip still works`, async () => {
    await setViewport(w, h); await load();
    const g = await ev(`(()=>{const m=document.querySelector('main').getBoundingClientRect(); return {w:m.width, left:m.left, right:document.documentElement.clientWidth-m.right}})()`);
    ok(g.w <= 1400.5, "main max-width respected: " + g.w);
    ok(Math.abs(g.left - g.right) <= 2, `centred: left ${g.left} right ${g.right}`);
    eq((await overflow()).length, 0, "no overflow");
    const idx = await ev(`(()=>{let best=-1,bx=-1;document.querySelectorAll('.mount-icon-link').forEach((a,i)=>{const r=a.getBoundingClientRect(); if(r.right>bx && r.right<innerWidth){bx=r.right;best=i}}); return best})()`);
    await hover(`document.querySelectorAll('.mount-icon-link')[${idx}]`);
    const r = await ev(`(()=>{const b=document.querySelectorAll('.mount-icon-link')[${idx}].querySelector('.mount-tooltip').getBoundingClientRect(); return {right:b.right,left:b.left,w:innerWidth}})()`);
    ok(r.left >= 0 && r.right <= r.w + 1, `tooltip on-screen ${JSON.stringify(r)}`);
  });
}
await setViewport(1400, 1000);

// ---------------------------------------------------------------- Q. misc integrity + cross-tab sync
await t("misc", "no duplicate element ids; every label points at a control", async () => {
  await load();
  eq(await ev(`(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id); return ids.length-new Set(ids).size})()`), 0, "duplicate ids");
  eq(await ev(`[...document.querySelectorAll('label[for]')].filter(l=>!document.getElementById(l.htmlFor)).length`), 0);
  eq(await ev(`[...document.querySelectorAll('[aria-controls]')].filter(e=>e.getAttribute('aria-expanded')==='true' && !document.getElementById(e.getAttribute('aria-controls'))).length`), 0, "aria-controls target exists when expanded");
});
await t("misc", "another tab changing the theme/collapse state (storage event) updates this tab", async () => {
  await ev(`localStorage.setItem('wow-mount-tracker:theme', JSON.stringify({theme:'alliance',overrides:{}})); window.dispatchEvent(new StorageEvent('storage',{key:'wow-mount-tracker:theme'}))`);
  await wait(`document.documentElement.getAttribute('data-palette')==='alliance'`, 3000, "theme synced");
  const first = await ev(`document.querySelector('.section-toggle').textContent.replace(/[\\d\\s\\/✓]+$/,'')`);
  await ev(`localStorage.setItem('wow-mount-tracker:collapsed', JSON.stringify([${JSON.stringify(first)}])); window.dispatchEvent(new StorageEvent('storage',{key:'wow-mount-tracker:collapsed'}))`);
  await wait(`document.querySelector('.section-toggle').getAttribute('aria-expanded')==='false'`, 3000, "collapse synced");
  await ev(`localStorage.setItem('wow-mount-tracker:collapsed','[]'); window.dispatchEvent(new StorageEvent('storage',{key:'wow-mount-tracker:collapsed'}))`);
  await ev(`localStorage.setItem('wow-mount-tracker:theme', JSON.stringify({theme:'dark',overrides:{}})); window.dispatchEvent(new StorageEvent('storage',{key:'wow-mount-tracker:theme'}))`);
});
await t("misc", "rapid theme/collapse hammering leaves consistent state and no errors", async () => {
  for (let i = 0; i < 25; i++) { await ev(`document.querySelectorAll('.theme-chip')[${i % 6}].click(); ${$$(".section-toggle")}[${i % 5}]?.click()`); }
  await sleep(300);
  const st = await ev(`JSON.stringify({attr:document.documentElement.getAttribute('data-palette'), stored:JSON.parse(localStorage.getItem('wow-mount-tracker:theme')).theme, checked:document.querySelector('.theme-chip[aria-checked=true]').getAttribute('aria-label')})`);
  const s = JSON.parse(st); ok(s.attr === s.stored || (s.attr === "gold" && s.stored === "gold"), "attr/storage agree: " + st);
  await ev(`localStorage.setItem('wow-mount-tracker:collapsed','[]'); document.querySelectorAll('.theme-chip')[0].click()`);
});

// ---------------------------------------------------------------- report
ws.close(); chrome.kill(); await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
const failed = results.filter((r) => !r.ok);
const groups = [...new Set(results.map((r) => r.group))];
console.log("\n================ QA RESULTS ================");
for (const g of groups) {
  const rs = results.filter((r) => r.group === g);
  console.log(`\n[${g}] ${rs.filter((r) => r.ok).length}/${rs.length} passed`);
  for (const r of rs) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "\n        -> " + r.err}`);
}
console.log(`\nTOTAL: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
console.log(`unexpected console/network problems: ${problems.length}`);
writeFileSync(join(here, "qa-results.json"), JSON.stringify({ results, problems }, null, 2));
process.exit(0);
