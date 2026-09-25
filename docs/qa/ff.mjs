// Firefox QA over WebDriver BiDi. Focus: the reported hydration error (Firefox
// restores form-control state on reload), plus a functional/visual smoke test.
// Usage: node ff.mjs [label]   (label only tags screenshot names)
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.QA_BASE ?? "http://localhost:3000";
const label = process.argv[2] ?? "ff";
const PORT = 9350;
const profile = join(here, `ffprofile-${Date.now()}`);
mkdirSync(profile, { recursive: true });
mkdirSync(join(here, "shots"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ff = spawn("C:\\Program Files\\Mozilla Firefox\\firefox.exe",
  ["-headless", "-no-remote", "-profile", profile, "--remote-debugging-port", String(PORT), "about:blank"], { stdio: "ignore" });

let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
    await new Promise((res, rej) => { s.onopen = res; s.onerror = rej; });
    ws = s;
  } catch { await sleep(500); }
}
if (!ws) { console.log("could not connect to Firefox BiDi"); ff.kill(); process.exit(1); }

let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "log.entryAdded") logs.push({ level: m.params.level, type: m.params.type, text: String(m.params.text ?? "").slice(0, 400) });
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const must = async (method, params) => { const r = await send(method, params); if (r.type === "error") throw new Error(`${method}: ${r.error} ${r.message}`); return r.result; };

const session = await must("session.new", { capabilities: { alwaysMatch: {} } });
console.log(`Firefox ${session.capabilities?.browserVersion} (${session.capabilities?.platformName}) connected via WebDriver BiDi`);
await must("session.subscribe", { events: ["log.entryAdded"] });
const tree = await must("browsingContext.getTree", {});
const ctx = tree.contexts[0].context;
await must("browsingContext.setViewport", { context: ctx, viewport: { width: 1400, height: 1000 } });
// Record the radios' state at DOMContentLoaded (before React hydrates) on every document.
await must("script.addPreloadScript", { functionDeclaration: `() => { document.addEventListener("DOMContentLoaded", () => { window.__pre = { palette: document.documentElement.getAttribute("data-palette"), radios: [...document.querySelectorAll('input[name=collection-filter]')].map(i => i.disabled + '/' + i.checked) }; }); }` });

const ev = async (expr) => {
  const r = await must("script.evaluate", { expression: `(async()=>{ const __v = await (${expr}); return JSON.stringify(__v === undefined ? null : __v); })()`, target: { context: ctx }, awaitPromise: true, resultOwnership: "none" });
  if (r.type === "exception") throw new Error("page JS error: " + r.exceptionDetails.text);
  return JSON.parse(r.result.value ?? "null");
};
const nav = async (url = BASE + "/") => { logs.length = 0; await must("browsingContext.navigate", { context: ctx, url, wait: "complete" }); await sleep(1800); };
const reload = async () => { logs.length = 0; await must("browsingContext.reload", { context: ctx, wait: "complete" }); await sleep(1800); };
const clickText = (sel, text) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)})); if(!e) throw new Error('no element ${text}'); e.click(); return true})()`);
const shot = async (name) => { const r = await must("browsingContext.captureScreenshot", { context: ctx, origin: "viewport" }); writeFileSync(join(here, "shots", `${label}-${name}.png`), Buffer.from(r.data, "base64")); };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };
const problems = () => logs.filter((l) => l.level === "error" || l.level === "warn").map((l) => `${l.level}: ${l.text.replace(/\s+/g, " ").slice(0, 150)}`);
const hydrationLogs = () => logs.filter((l) => /hydrat/i.test(l.text));
const hydrationErrors = () => hydrationLogs().filter((l) => l.level === "error" || l.level === "warn").length;
const showHydration = (tag) => { const h = hydrationLogs(); if (h.length) console.log(`   [${tag}] hydration-related log entries: ` + h.map((l) => `${l.level}/${l.type}: "${l.text.slice(0, 60)}"`).join(" ; ")); };

console.log("\n[1] First load, no scan");
await nav();
check("title/heading render", (await ev("document.title")) === "Mount Tracker" && (await ev("document.querySelector('h1').textContent")) === "WoW Mount Collection Tracker");
check("default Dark theme applied", (await ev("document.documentElement.getAttribute('data-palette')")) === "dark");
let pre = await ev("window.__pre");
check("server HTML radios arrive disabled", JSON.stringify(pre.radios) === JSON.stringify(["false/true", "true/false", "true/false"]), JSON.stringify(pre));
check("no console errors/hydration warnings", problems().length === 0, problems().join(" || "));

console.log("\n[2] Scan a character through the real UI, then reload (the restore scenario)");
const fill = (sel, v) => ev(`(()=>{const i=document.querySelector(${JSON.stringify(sel)}); i.focus(); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
await fill('.search-bar input[placeholder="Realm"]', "Tichondrius");
await fill('.search-bar input[placeholder="Character name"]', "Kurowastaken");
await must("input.performActions", { context: ctx, actions: [{ type: "key", id: "kb", actions: [{ type: "keyDown", value: "\uE007" }, { type: "keyUp", value: "\uE007" }] }] });
for (let i = 0; i < 40; i++) { await sleep(300); if (/^Loaded \d+ owned/.test((await ev("document.querySelector('.search-status')?.textContent ?? ''")))) break; }
const summary = await ev("document.querySelector('.collection-summary').textContent");
check("scan completes; summary shows collected/total", /\d+ \/ \d+ mounts collected/.test(summary), summary.slice(0, 70));
check("Collected/Uncollected enabled after scan", (await ev("[...document.querySelectorAll('.segment-input')].every(i=>!i.disabled)")) === true);
await shot("scanned-dark");
for (let n = 1; n <= 4; n++) {
  if (n === 3) await clickText(".segment", "Collected"); // change form state before reloading
  await reload();
  pre = await ev("window.__pre");
  const now = await ev("[...document.querySelectorAll('input[name=collection-filter]')].map(i=>i.disabled+'/'+i.checked)");
  const restored = JSON.stringify(pre.radios) !== JSON.stringify(["false/true", "true/false", "true/false"]);
  console.log(`   reload #${n}${n === 3 ? " (after clicking 'Collected')" : ""}: DOM radios before hydration = ${JSON.stringify(pre.radios)} ${restored ? "<- Firefox altered the server HTML" : "(matches server HTML)"}; after = ${JSON.stringify(now)}`);
  showHydration(`reload #${n}`);
  check(`reload #${n}: zero hydration errors`, hydrationErrors() === 0, hydrationErrors() ? logs.filter((l) => /hydrat/i.test(l.text))[0].text.slice(0, 120) : "");
  check(`reload #${n}: cached scan restored + filter radios enabled`, /Showing cached collection/.test(await ev("document.querySelector('.search-status')?.textContent ?? ''")) && (await ev("[...document.querySelectorAll('.segment-input')].every(i=>!i.disabled)")) === true);
  const other = problems().filter((p) => !/hydrat/i.test(p));
  check(`reload #${n}: no other console errors`, other.length === 0, other.join(" || "));
}
await clickText(".segment", "All");

console.log("\n[3] Functional smoke test in Firefox");
await nav();
const iconCount = await ev("document.querySelectorAll('.mount-icon-link').length");
check("catalog renders (scanned): owned + unowned icons", (await ev("document.querySelectorAll('.mount-icon-link.owned').length")) > 500 && iconCount > 1400, `${iconCount} icons`);
await clickText(".segment", "Collected");
check("filter: Collected shows only owned", (await ev("document.querySelectorAll('.mount-icon-link.unowned').length")) === 0);
await clickText(".segment", "All");
await clickText(".toggle", "Show retired");
check("toggle: Show retired off reduces icons", (await ev("document.querySelectorAll('.mount-icon-link').length")) < iconCount);
await clickText(".toggle", "Show retired");
await clickText(".filter-button", "Collapse all");
check("Collapse all removes all icons from DOM", (await ev("document.querySelectorAll('.mount-icon-link').length")) === 0);
await shot("collapsed-dark");
await reload();
check("collapsed state persists across reload (no hydration error)", (await ev("document.querySelectorAll('.mount-icon-link').length")) === 0 && hydrationErrors() === 0);
await clickText(".filter-button", "Expand all");
for (const themeName of ["Light", "Void", "Alliance", "Horde", "Azeroth Gold", "Dark"]) {
  await ev(`document.querySelector('.theme-chip[aria-label="${themeName}"]').click()`);
  const p = await ev("document.documentElement.getAttribute('data-palette')");
  const bg = await ev("getComputedStyle(document.body).backgroundColor");
  if (themeName === "Light" || themeName === "Void") { await sleep(200); await shot(`theme-${themeName.toLowerCase()}`); }
  check(`theme ${themeName}: palette attribute + background applied`, p === (themeName === "Azeroth Gold" ? "gold" : themeName.toLowerCase()) && !!bg, `${p} ${bg}`);
}
await ev(`document.querySelector('.theme-chip[aria-label="Void"]').click()`);
await reload();
check("theme persists across reload and is set before hydration", (await ev("document.documentElement.getAttribute('data-palette')")) === "void" && (await ev("window.__pre.palette")) === "void" && hydrationErrors() === 0);
await ev(`document.querySelector('.theme-chip[aria-label="Dark"]').click()`);
// CSS features the design relies on
const css = await ev(`({colorMix: CSS.supports('background','color-mix(in srgb, red 50%, black)'), has: CSS.supports('selector(:has(*))'), inset: CSS.supports('inset','0'), borderImage: CSS.supports('border-image','linear-gradient(90deg, red, blue) 1')})`);
check("CSS features used by the theme are supported", Object.values(css).every(Boolean), JSON.stringify(css));
// tooltip + hover
const pos = await ev(`(()=>{const a=document.querySelector('.mount-icon-link.owned'); a.scrollIntoView({block:'center'}); const r=a.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}})()`);
await must("input.performActions", { context: ctx, actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", x: pos.x, y: pos.y, origin: "viewport" }] }] });
await sleep(300);
const tip = await ev(`(()=>{const t=document.querySelector('.mount-icon-link:hover .mount-tooltip'); if(!t) return null; const r=t.getBoundingClientRect(); return {d:getComputedStyle(t).display, l:r.left, r:r.right, w:innerWidth, txt:t.textContent.includes('Collected')}})()`);
check("hover tooltip appears, on-screen, says Collected (real pointer move)", !!tip && tip.d === "flex" && tip.l >= 0 && tip.r <= tip.w && tip.txt, JSON.stringify(tip));
await shot("tooltip");

console.log("\n[4] Dailies in Firefox");
await ev(`window.scrollTo(0,0)`);
await clickText(".view-tab", "Dailies");
await sleep(400);
check("Dailies renders cards + summary", (await ev("document.querySelectorAll('.farm-card').length")) > 5 && /uncollected mounts across/.test(await ev("document.querySelector('.dailies-summary').textContent")));
const before = await ev("parseInt(document.querySelector('.dailies-summary').textContent.match(/(\\d+) left this reset/)[1])");
await ev(`document.querySelector('.farm-done-button:not(.undo)').click()`);
await sleep(200);
check("Done decrements 'left this reset' and moves the card to Completed", (await ev("parseInt(document.querySelector('.dailies-summary').textContent.match(/(\\d+) left this reset/)[1])")) === before - 1 && (await ev("document.querySelectorAll('.dailies-completed .farm-card').length")) === 1);
await reload();
await clickText(".view-tab", "Dailies");
check("done state persists across a Firefox reload", (await ev("document.querySelectorAll('.dailies-completed .farm-card').length")) === 1);
await shot("dailies");
await ev(`document.querySelector('.farm-done-button.undo').click()`); // clean up
await sleep(200);
check("Undo returns the card", (await ev("document.querySelectorAll('.dailies-completed').length")) === 0);

console.log("\n[6] Realm type-ahead in Firefox");
const { readFileSync: readFs } = await import("node:fs");
const realmsData = JSON.parse(readFs("C:\\Users\\atany\\wow-mount-tracker\\data\\realms.json", "utf8")).regions;
const combo = () => ev(`(()=>{const i=document.querySelector('.realm-combobox input'); const a=i.getAttribute('aria-activedescendant'); return {value:i.value, expanded:i.getAttribute('aria-expanded'), invalid:i.getAttribute('aria-invalid'), activeText:a?document.getElementById(a)?.textContent:null, options:[...document.querySelectorAll('.realm-option')].map(o=>o.textContent), header:document.querySelector('.realm-empty')?.textContent ?? null}})()`);
const press = (k) => must("input.performActions", { context: ctx, actions: [{ type: "key", id: "kb", actions: [{ type: "keyDown", value: k }, { type: "keyUp", value: k }] }] });
const KEY = { Down: "\uE015", Enter: "\uE007", Esc: "\uE00C", Tab: "\uE004" };
const setRegionFF = (r) => ev(`(()=>{const s=document.querySelector('.search-bar select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(r)}); s.dispatchEvent(new Event('change',{bubbles:true}))})()`);

await nav(); // cached scan from section 2 is restored
check("realm text restored after a Firefox reload, no hydration error", (await combo()).value === "Tichondrius" && hydrationErrors() === 0, JSON.stringify((await combo()).value));
// A script-called .focus() does not dispatch focus events in an unfocused headless window, so click the field like a user would.
await ev(`document.querySelector('.realm-combobox input').click()`); await sleep(200);
let s = await combo();
check("clicking the field opens the whole US realm list", s.expanded === "true" && s.options.length === realmsData.us.length, `${s.options.length} options, expected ${realmsData.us.length}`);
await fill(".realm-combobox input", "tich"); await sleep(200);
s = await combo();
check("typing filters; Tichondrius first", s.options[0] === "Tichondrius" && s.options.length < 10, JSON.stringify(s.options.slice(0, 3)));
await press(KEY.Down); await sleep(150);
check("ArrowDown highlights via aria-activedescendant", (await combo()).activeText === "Tichondrius");
await press(KEY.Enter); await sleep(200);
s = await combo();
check("Enter picks the realm and closes the list (no submit)", s.value === "Tichondrius" && s.expanded === "false" && !/Loaded|not found|isn't/.test(await ev("document.querySelector('.search-status')?.textContent ?? ''")));
await ev(`document.querySelector('.realm-combobox input').click()`); await sleep(200);
check("clicking the still-focused field reopens the list", (await combo()).expanded === "true");
await press(KEY.Esc); await sleep(150);
check("Escape closes without clearing", (await combo()).expanded === "false" && (await combo()).value === "Tichondrius");
await fill(".realm-combobox input", "Tichondrus"); await fill('.search-bar input[placeholder="Character name"]', "Testchar"); await sleep(200);
await ev(`document.querySelector('.search-bar button[type=submit]').click()`); await sleep(400);
const errText = await ev("document.querySelector('.search-status')?.textContent ?? ''");
check("typo'd realm: clear message with a suggestion, field marked invalid", /isn't a US realm/.test(errText) && /Did you mean Tichondrius/.test(errText) && (await combo()).invalid === "true", errText);
await fill(".realm-combobox input", "Tichondrius"); await sleep(200);
check("editing the realm clears the error", (await ev("document.querySelector('.search-status')?.textContent ?? null")) === null || !/isn't a US realm/.test(await ev("document.querySelector('.search-status')?.textContent ?? ''")));
await setRegionFF("kr"); await sleep(250);
check("switching to KR drops a US-only realm", (await combo()).value === "");
await ev(`document.querySelector('.realm-combobox input').focus()`); await sleep(200);
await fill(".realm-combobox input", "azsh"); await sleep(200);
s = await combo();
check("Korean realm found by its English slug (azsh -> 아즈샤라)", s.options[0] === "아즈샤라", JSON.stringify(s.options.slice(0, 2)));
await shot("realm-korean");
await setRegionFF("us"); await fill(".realm-combobox input", "Tichondrius"); await press(KEY.Tab);
await fill('.search-bar input[placeholder="Character name"]', "Kurowastaken");

console.log("\n[5] Whole-session console check");
const allProblems = problems();
check("no console errors/warnings on the last page state", allProblems.length === 0, allProblems.join(" || "));

const failed = results.filter((r) => !r.ok);
console.log(`\nFIREFOX: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
writeFileSync(join(here, `ff-results-${label}.json`), JSON.stringify(results, null, 2));
try { await send("session.end", {}); } catch {}
ws.close(); ff.kill();
await sleep(1200);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
