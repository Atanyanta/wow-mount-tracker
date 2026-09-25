// Quick unit check of lib/realms.js in plain Node: swap the "@/data/realms.json"
// alias import for a file read, then import the result.
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = "C:\\Users\\atany\\wow-mount-tracker";
const src = readFileSync(join(ROOT, "lib", "realms.js"), "utf8").replace(
  'import realmData from "@/data/realms.json";',
  `import { readFileSync } from "node:fs"; const realmData = JSON.parse(readFileSync(${JSON.stringify(join(ROOT, "data", "realms.json"))}, "utf8"));`
);
const tmp = join(here, "realms.under-test.mjs");
writeFileSync(tmp, src);
const { findRealm, searchRealms, suggestRealms, getRealms, normalizeText } = await import(pathToFileURL(tmp).href);

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };
const slug = (r) => r?.slug ?? null;

t("exact by slug", slug(findRealm("us", "tichondrius")) === "tichondrius");
t("case-insensitive", slug(findRealm("us", "TICHONDRIUS")) === "tichondrius");
t("apostrophe/space/hyphen-insensitive: Kel'Thuzad", ["kel thuzad", "KEL'THUZAD", "kelthuzad", "Kel’Thuzad"].every((s) => slug(findRealm("eu", s)) === "kelthuzad"),
  JSON.stringify(["kel thuzad", "KEL'THUZAD", "kelthuzad"].map((s) => slug(findRealm("eu", s)))));
t("Azjol-Nerub (real slug has no hyphen)", ["Azjol-Nerub", "azjol nerub", "azjolnerub"].every((s) => slug(findRealm("eu", s)) === "azjolnerub"));
t("accents optional: Aggra (Portugues) == Aggra (Português)", slug(findRealm("eu", "Aggra (Portugues)")) === "aggra-português" && slug(findRealm("eu", "aggra portugues")) === "aggra-português");
t("Area 52 / area52 / area-52", ["Area 52", "area52", "area-52"].every((s) => slug(findRealm("us", s)) === "area-52"));
t("Korean name and English slug both find the realm", slug(findRealm("kr", "아즈샤라")) === "azshara" && slug(findRealm("kr", "azshara")) === "azshara");
t("Taiwan name and slug", slug(findRealm("tw", "血之谷")) === "bleeding-hollow" && slug(findRealm("tw", "bleeding hollow")) === "bleeding-hollow");
t("typo is NOT an exact match", findRealm("us", "Tichondrus") === null && findRealm("us", "Tichondriu") === null);
t("realm from another region is not matched (Korean realm in US)", findRealm("us", "아즈샤라") === null);
t("empty/whitespace input -> null", findRealm("us", "") === null && findRealm("us", "   ") === null);
t("unknown region -> empty list, no crash", getRealms("xx").length === 0 && findRealm("xx", "a") === null && searchRealms("xx", "a").length === 0);
t("counts per region are sane", getRealms("us").length > 200 && getRealms("eu").length > 200 && getRealms("kr").length >= 15 && getRealms("tw").length >= 20, [getRealms("us").length, getRealms("eu").length, getRealms("kr").length, getRealms("tw").length].join("/"));

const tich = searchRealms("us", "tich");
t("search 'tich' -> Tichondrius first", tich[0]?.name === "Tichondrius", tich.slice(0, 3).map((r) => r.name).join(","));
t("search empty -> whole region list", searchRealms("us", "", 1000).length === getRealms("us").length);
t("search respects limit", searchRealms("us", "", 10).length === 10);
const thuz = searchRealms("eu", "thuz");
t("substring search finds Kel'Thuzad", thuz.some((r) => r.slug === "kelthuzad"));
const ranks = searchRealms("us", "an");
t("prefix matches rank before substring matches", ranks.findIndex((r) => r.nameKey?.startsWith?.("an") ?? normalizeText(r.name).startsWith("an")) === 0, ranks.slice(0, 4).map((r) => r.name).join(","));
t("search by English slug finds Korean realm", searchRealms("kr", "azshara").some((r) => r.slug === "azshara"));
t("no match -> empty", searchRealms("us", "qqqxxxzzz").length === 0);
t("results are alphabetical within the same rank", (() => { const r = searchRealms("us", "a", 1000).filter((x) => x.nameKey.startsWith("a")); return r.every((x, i) => i === 0 || r[i - 1].name.localeCompare(x.name, "en", { sensitivity: "base" }) <= 0); })());

const s1 = suggestRealms("us", "Tichondrus");
t("suggest: 'Tichondrus' -> Tichondrius", s1[0]?.name === "Tichondrius", s1.map((r) => r.name).join(","));
t("suggest: 'Illidn' -> Illidan", suggestRealms("us", "Illidn")[0]?.name === "Illidan");
t("suggest: 'Stormrge' -> Stormrage", suggestRealms("us", "Stormrge").some((r) => r.name === "Stormrage"));
t("suggest: gibberish -> nothing", suggestRealms("us", "zzzzzzzzzz").length === 0);
t("suggest: too-short input -> nothing", suggestRealms("us", "ab").length === 0);

const t0 = performance.now();
for (let i = 0; i < 2000; i++) searchRealms("eu", ["k", "ke", "kel", "thu", "a", "sil"][i % 6]);
const ms = performance.now() - t0;
t(`2000 searches take < 300 ms (took ${ms.toFixed(0)} ms)`, ms < 300);
const t1 = performance.now();
for (let i = 0; i < 200; i++) suggestRealms("eu", "Tichondrus" + (i % 3));
t(`200 suggestion lookups take < 300 ms (took ${(performance.now() - t1).toFixed(0)} ms)`, performance.now() - t1 < 300);

try { unlinkSync(tmp); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
