"use client";

import { useEffect, useState } from "react";

const LAST_SEARCH_KEY = "wow-mount-tracker:last-search";
const REGIONS = ["us", "eu", "kr", "tw"];

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

function writeCache(query, ownedIds, faction) {
  try {
    localStorage.setItem(
      cacheKey(query),
      JSON.stringify({ ownedIds, faction, fetchedAt: Date.now() })
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
      // One-time hydration from localStorage (an external system, per React's
      // own guidance on effects) - not state that could be derived at render
      // time, since it doesn't exist during server rendering.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRegion(last.region || "us");
      setRealm(last.realm || "");
      setName(last.name || "");
      const cached = readCache(last);
      if (cached) {
        onScanResult({
          ownedIds: new Set(cached.ownedIds),
          faction: cached.faction ?? null,
          character: { region: last.region || "us", realm: last.realm || "", name: last.name || "" },
        });
        setLastFetchedAt(cached.fetchedAt);
        setStatus({
          type: "info",
          text: `Showing cached collection for ${last.name} (${last.realm}) from ${new Date(cached.fetchedAt).toLocaleString()}`,
        });
      }
    } catch {
      // ignore malformed localStorage state
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runScan(e) {
    e?.preventDefault();
    if (!realm.trim() || !name.trim()) {
      setStatus({ type: "error", text: "Enter a character name and realm." });
      return;
    }
    const query = { region, realm, name };
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
      writeCache(query, data.ownedIds, data.faction);
      onScanResult({ ownedIds: new Set(data.ownedIds), faction: data.faction ?? null, character: query });
      const now = Date.now();
      setLastFetchedAt(now);
      setStatus({
        type: "info",
        text: `Loaded ${data.ownedIds.length} owned mounts for ${name.trim()} (${realm.trim()}) just now.`,
      });
    } catch {
      setStatus({ type: "error", text: "Network error, try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="search-bar" onSubmit={runScan}>
      <select value={region} onChange={(e) => setRegion(e.target.value)}>
        {REGIONS.map((r) => (
          <option key={r} value={r}>
            {r.toUpperCase()}
          </option>
        ))}
      </select>
      <input
        placeholder="Realm"
        value={realm}
        onChange={(e) => setRealm(e.target.value)}
      />
      <input
        placeholder="Character name"
        value={name}
        onChange={(e) => setName(e.target.value)}
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
