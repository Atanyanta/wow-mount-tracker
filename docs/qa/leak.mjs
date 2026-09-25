// Client-side leak test. Runs the same set of interactions for several cycles,
// forcing GC before each measurement. A leak shows up as heap / DOM nodes /
// event listeners that keep growing from cycle to cycle.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 9338;
const profile = join(here, `profile-leak-${Date.now()}`);
const CYCLES = Number(process.argv[2] ?? 4);
const chrome = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1400,1000", "about:blank"],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
  await sleep(250);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) return pending.get(m.id)(m), pending.delete(m.id);
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type))
    problems.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 120).replace(/\s+/g, " "));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 120));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Performance.enable");
await send("HeapProfiler.enable");

async function measure() {
  await send("HeapProfiler.collectGarbage");
  await sleep(250);
  await send("HeapProfiler.collectGarbage");
  const { result } = await send("Performance.getMetrics");
  const g = (n) => result.metrics.find((m) => m.name === n)?.value ?? 0;
  return { heapMB: g("JSHeapUsedSize") / 1048576, nodes: g("Nodes"), listeners: g("JSEventListeners"), docs: g("Documents") };
}

// Seed a real scan so scanned-state code paths (owned sets, bars, counts) run.
const data = await (await fetch("http://localhost:3000/api/collections?region=us&realm=tichondrius&name=kurowastaken")).json();
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(2500);
await ev(`(() => {
  localStorage.setItem("wow-mount-tracker:last-search", JSON.stringify({region:"us",realm:"Tichondrius",name:"Kurowastaken"}));
  localStorage.setItem("wow-mount-tracker:owned:us:tichondrius:kurowastaken", JSON.stringify({ownedIds:${JSON.stringify(data.ownedIds)},usableIds:${JSON.stringify(data.usableIds)},faction:${JSON.stringify(data.faction)},fetchedAt:Date.now()}));
})()`);
await send("Page.navigate", { url: "http://localhost:3000/" });
await sleep(3500);

const click = (expr) => ev(`(${expr})?.click()`);
const btn = (cls, text) => `[...document.querySelectorAll('${cls}')].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;

const phases = {
  "theme switching (6 themes x 8)": async () => {
    for (let r = 0; r < 8; r++) for (let i = 0; i < 6; i++) { await click(`document.querySelectorAll('.theme-chip')[${i}]`); await sleep(60); }
    await click(`document.querySelectorAll('.theme-chip')[0]`);
  },
  "collapse all / expand all (x12)": async () => {
    for (let r = 0; r < 12; r++) { await click(btn(".filter-button", "Collapse all")); await sleep(120); await click(btn(".filter-button", "Expand all")); await sleep(180); }
  },
  "single section toggle (x30)": async () => {
    for (let r = 0; r < 30; r++) { await click(`document.querySelector('.section-toggle')`); await sleep(80); }
    await click(btn(".filter-button", "Expand all"));
  },
  "filter cycling All/Collected/Uncollected (x10)": async () => {
    for (let r = 0; r < 10; r++) for (const f of ["Collected", "Uncollected", "All"]) { await click(`[...document.querySelectorAll('.segment')].find(s => s.textContent === '${f}')`); await sleep(150); }
    await click(btn(".toggle", "Show retired")); await sleep(150); await click(btn(".toggle", "Show retired"));
  },
  "Collection <-> Dailies tab (x12) + Dailies toggles": async () => {
    for (let r = 0; r < 12; r++) {
      await click(btn(".view-tab", "Dailies")); await sleep(200);
      await click(btn(".toggle", "Include collected")); await sleep(100);
      await click(btn(".toggle", "Hide completed")); await sleep(100);
      await click(`document.querySelector('.farm-done-button:not(.undo)')`); await sleep(100);
      await click(`document.querySelector('.farm-done-button.undo')`); await sleep(100);
      await click(btn(".toggle", "Include collected")); await click(btn(".toggle", "Hide completed"));
      await click(btn(".view-tab", "Collection")); await sleep(300);
    }
  },
  "rescan via search bar (x3, real API calls)": async () => {
    for (let r = 0; r < 3; r++) {
      await click(`document.querySelector('.search-bar button[type=submit]')`);
      for (let i = 0; i < 40; i++) { await sleep(250); if (!(await ev(`document.querySelector('.search-bar button[type=submit]').disabled`))) break; }
      await sleep(300);
    }
  },
};

console.log(`Warm-up + ${CYCLES} measured cycles. Each cycle runs all ${Object.keys(phases).length} activities.\n`);
// warm-up cycle (lets JIT / caches / lazy images settle) - not measured
for (const fn of Object.values(phases)) await fn();
const base = await measure();
console.log(`baseline after warm-up: heap ${base.heapMB.toFixed(1)} MB | DOM nodes ${base.nodes} | listeners ${base.listeners} | documents ${base.docs}`);

const rows = [];
for (let c = 1; c <= CYCLES; c++) {
  const perPhase = [];
  for (const [name, fn] of Object.entries(phases)) {
    const before = await measure();
    await fn();
    const after = await measure();
    perPhase.push({ name, dHeap: after.heapMB - before.heapMB, dNodes: after.nodes - before.nodes, dList: after.listeners - before.listeners });
  }
  const m = await measure();
  rows.push(m);
  console.log(`cycle ${c}: heap ${m.heapMB.toFixed(1)} MB (${(m.heapMB - base.heapMB >= 0 ? "+" : "")}${(m.heapMB - base.heapMB).toFixed(1)} vs baseline) | nodes ${m.nodes} (${m.nodes - base.nodes >= 0 ? "+" : ""}${m.nodes - base.nodes}) | listeners ${m.listeners} (${m.listeners - base.listeners >= 0 ? "+" : ""}${m.listeners - base.listeners}) | docs ${m.docs}`);
  if (c === CYCLES) {
    console.log("\nlast-cycle net change per activity (after GC):");
    for (const p of perPhase) console.log(`  ${p.name.padEnd(52)} heap ${p.dHeap >= 0 ? "+" : ""}${p.dHeap.toFixed(2)} MB | nodes ${p.dNodes >= 0 ? "+" : ""}${p.dNodes} | listeners ${p.dList >= 0 ? "+" : ""}${p.dList}`);
  }
}

// Informational: how big is the page itself?
const expanded = await measure();
await click(btn(".filter-button", "Collapse all"));
await sleep(400);
const collapsed = await measure();
console.log(`\npage size: all sections expanded -> ${expanded.nodes} DOM nodes, ${expanded.heapMB.toFixed(1)} MB heap | all collapsed -> ${collapsed.nodes} nodes, ${collapsed.heapMB.toFixed(1)} MB`);
console.log(`console problems during the whole run: ${problems.length ? problems.join(" || ") : "(none)"}`);

ws.close();
chrome.kill();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
