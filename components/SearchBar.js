"use client";

import { useEffect, useState } from "react";
import { findRealm, getRealms, suggestRealms } from "@/lib/realms";
import RealmCombobox from "./RealmCombobox";

const LAST_SEARCH_KEY = "wow-mount-tracker:last-search";
const REGIONS = ["us", "eu", "kr", "tw"];

// `realm` in a query is the realm's slug (Blizzard's own, from data/realms.json),
// lower-case - so cache and "done" keys are the same however the realm was typed.
function cacheKey({ region, realm, name }) {
  return `wow-mount-tracker:owned:${region}:${realm.trim().toLowerCase()}:${name.trim().toLowerCase()}`;
}

function readCache(query) {
  try {
    const raw = localStorage.getItem(cacheKey(query));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(query, ownedIds, usableIds, faction) {
  try {
    localStorage.setItem(
      cacheKey(query),
      JSON.stringify({ ownedIds, usableIds, faction, fetchedAt: Date.now() })
    );
    localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(query));
  } catch {
    // Storage disabled/full - the scan itself still succeeded, so don't let
    // this stop onScanResult from firing below.
  }
}

export default function SearchBar({ onScanResult }) {
  const [region, setRegion] = useState("us");
  const [realm, setRealm] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState(null); // { type: "error" | "info", text }
  const [loading, setLoading] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_SEARCH_KEY);
      if (!raw) return;
      const last = JSON.parse(raw);
      const lastRegion = last.region || "us";
      // Older versions saved the realm as typed ("Area 52"); newer ones save its
      // slug. Either resolves to the same realm, shown by its proper name.
      const lastRealm = findRealm(lastRegion, last.realm || "");
      const realmName = lastRealm?.name ?? (last.realm || "");
      const realmSlug = lastRealm?.slug ?? (last.realm || "");
      // One-time hydration from localStorage (an external system, per React's
      // own guidance on effects) - not state that could be derived at render
      // time, since it doesn't exist during server rendering.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRegion(lastRegion);
      setRealm(realmName);
      setName(last.name || "");
      const cached =
        readCache({ region: lastRegion, realm: realmSlug, name: last.name || "" }) ??
        readCache({ region: lastRegion, realm: last.realm || "", name: last.name || "" });
      if (cached) {
        onScanResult({
          ownedIds: new Set(cached.ownedIds),
          // Scans cached before usable counts existed have no usableIds -
          // leave it null (the summary prompts a rescan) rather than
          // spending a Blizzard call automatically.
          usableIds: cached.usableIds ? new Set(cached.usableIds) : null,
          faction: cached.faction ?? null,
          character: { region: lastRegion, realm: realmSlug, name: last.name || "" },
        });
        setLastFetchedAt(cached.fetchedAt);
        setStatus({
          type: "info",
          text: `Showing cached collection for ${last.name} (${realmName}) from ${new Date(cached.fetchedAt).toLocaleString()}`,
        });
      }
    } catch {
      // ignore malformed localStorage state
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An error message is about the text that was in the form when it appeared, so
  // it goes away as soon as the user edits the form (info messages stay).
  const clearError = () => setStatus((s) => (s?.type === "error" ? null : s));

  // A realm exists in one region, so switching region drops a realm that isn't
  // in the new region's list instead of leaving a mismatched pair in the form.
  function changeRegion(next) {
    clearError();
    setRegion(next);
    if (realm.trim() && getRealms(next).length > 0 && !findRealm(next, realm)) setRealm("");
  }

  async function runScan(e) {
    e?.preventDefault();
    if (!realm.trim() || !name.trim()) {
      setStatus({ type: "error", text: "Enter a character name and realm." });
      return;
    }
    // Only real realms go to the API. (If a region has no list at all, fall back
    // to free text rather than blocking the search.)
    const realmMatch = findRealm(region, realm);
    if (!realmMatch && getRealms(region).length > 0) {
      const tips = suggestRealms(region, realm);
      setStatus({
        type: "error",
        text:
          `"${realm.trim()}" isn't a ${region.toUpperCase()} realm - pick one from the list.` +
          (tips.length ? ` Did you mean ${tips.map((t) => t.name).join(", ")}?` : ""),
      });
      return;
    }
    const query = { region, realm: realmMatch?.slug ?? realm.trim(), name: name.trim() };
    const realmLabel = realmMatch?.name ?? realm.trim();
    setLoading(true);
    setStatus(null);
    try {
      const params = new URLSearchParams(query);
      const res = await fetch(`/api/collections?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        // A 404 means the searched character doesn't exist, so whatever is
        // still on screen belongs to a *different* character than the one in
        // the search box - clear it rather than leave misleading results.
        // Transient failures (rate limit, 5xx) keep the previous results,
        // which the status line labels by character.
        if (res.status === 404) {
          onScanResult(null);
          setLastFetchedAt(null);
        }
        setStatus({ type: "error", text: data.error || "Lookup failed" });
        return;
      }
      writeCache(query, data.ownedIds, data.usableIds, data.faction);
      onScanResult({
        ownedIds: new Set(data.ownedIds),
        usableIds: data.usableIds ? new Set(data.usableIds) : null,
        faction: data.faction ?? null,
        character: query,
      });
      const now = Date.now();
      setLastFetchedAt(now);
      setStatus({
        type: "info",
        text: `Loaded ${data.ownedIds.length} owned mounts for ${query.name} (${realmLabel}) just now.`,
      });
    } catch {
      setStatus({ type: "error", text: "Network error, try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="search-bar" onSubmit={runScan}>
      <select value={region} onChange={(e) => changeRegion(e.target.value)} aria-label="Region">
        {REGIONS.map((r) => (
          <option key={r} value={r}>
            {r.toUpperCase()}
          </option>
        ))}
      </select>
      <RealmCombobox
        region={region}
        value={realm}
        onChange={(text) => {
          clearError();
          setRealm(text);
        }}
      />
      <input
        placeholder="Character name"
        aria-label="Character name"
        value={name}
        onChange={(e) => {
          clearError();
          setName(e.target.value);
        }}
      />
      <button type="submit" disabled={loading}>
        {loading ? "Scanning..." : lastFetchedAt ? "Rescan" : "Scan"}
      </button>
      {status ? (
        <span className={`search-status${status.type === "error" ? " error" : ""}`}>
          {status.text}
        </span>
      ) : null}
    </form>
  );
}
