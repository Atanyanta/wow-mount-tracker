"use client";

import { useEffect, useRef, useState } from "react";
import { findRealm, getRealms, suggestRealms } from "@/lib/realms";
import RealmCombobox from "./RealmCombobox";

const LAST_SEARCH_KEY = "wow-mount-tracker:last-search";
const REGIONS = ["us", "eu", "kr", "tw"];

// `realm` in a query is the realm's slug (Blizzard's own, from data/realms.json),
// lower-case - so cache and "done" keys are the same however the realm was typed.
function cacheKey({ region, realm, name }) {
  return `wow-mount-tracker:owned:${region}:${realm.trim().toLowerCase()}:${name.trim().toLowerCase()}`;
}

// WoW character names are always a capital first letter and the rest lower
// case ("kurowastaken" -> "Kurowastaken"). The API returns the exact spelling
// after a scan; this covers searches saved before that (and scripts with no
// case, like Korean, pass through unchanged).
function formatCharacterName(name) {
  const trimmed = name.trim();
  return trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1).toLocaleLowerCase();
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

function writeCache(query, { ownedIds, usableIds, faction, avatar }) {
  try {
    localStorage.setItem(
      cacheKey(query),
      JSON.stringify({ ownedIds, usableIds, faction, avatar, fetchedAt: Date.now() })
    );
    localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(query));
  } catch {
    // Storage disabled/full - the scan itself still succeeded, so don't let
    // this stop onScanResult from firing below.
  }
}

// The search area has two modes. With no character loaded it is the search
// form (region / realm / name / Scan). Once a character is loaded it collapses
// to Rescan + "Scan another character" on the left and the character's
// portrait and Name-Realm on the right; "Scan another character" reopens the
// form (with Cancel to go back) without clearing what's on screen.
export default function SearchBar({ onScanResult }) {
  const [region, setRegion] = useState("us");
  const [realm, setRealm] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  // Screen-reader-only confirmation of a finished scan (there is no visible
  // "loaded" message; the name plate appearing is the visual cue).
  const [announcement, setAnnouncement] = useState("");
  const [loading, setLoading] = useState(false);
  // The character whose collection is on screen:
  // { region, realm (slug), realmName, name, avatar } - or null.
  const [current, setCurrent] = useState(null);
  const [editing, setEditing] = useState(false);
  const nameInputRef = useRef(null);
  const anotherButtonRef = useRef(null);
  const focusNext = useRef(null); // "name" | "another", applied after the mode switch renders

  const showForm = !current || editing;

  useEffect(() => {
    if (focusNext.current === "name") nameInputRef.current?.focus();
    if (focusNext.current === "another") anotherButtonRef.current?.focus();
    focusNext.current = null;
  }, [showForm]);

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
      const lastName = formatCharacterName(last.name || "");
      // One-time hydration from localStorage (an external system, per React's
      // own guidance on effects) - not state that could be derived at render
      // time, since it doesn't exist during server rendering.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRegion(lastRegion);
      setRealm(realmName);
      setName(lastName);
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
        // Restored silently. Scans cached before portraits existed have no
        // avatar; the plate shows an initial until the next rescan.
        setCurrent({ region: lastRegion, realm: realmSlug, realmName, name: lastName, avatar: cached.avatar ?? null });
      }
    } catch {
      // ignore malformed localStorage state
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An error message is about the text that was in the form when it appeared,
  // so it goes away as soon as the user edits the form.
  const clearError = () => setError(null);

  // A realm exists in one region, so switching region drops a realm that isn't
  // in the new region's list instead of leaving a mismatched pair in the form.
  function changeRegion(next) {
    clearError();
    setRegion(next);
    if (realm.trim() && getRealms(next).length > 0 && !findRealm(next, realm)) setRealm("");
  }

  async function scan(target) {
    if (!target.realm.trim() || !target.name.trim()) {
      setError("Enter a character name and realm.");
      return;
    }
    // Only real realms go to the API. (If a region has no list at all, fall back
    // to free text rather than blocking the search.)
    const realmMatch = findRealm(target.region, target.realm);
    if (!realmMatch && getRealms(target.region).length > 0) {
      const tips = suggestRealms(target.region, target.realm);
      setError(
        `"${target.realm.trim()}" isn't a ${target.region.toUpperCase()} realm - pick one from the list.` +
          (tips.length ? ` Did you mean ${tips.map((t) => t.name).join(", ")}?` : "")
      );
      return;
    }
    const query = { region: target.region, realm: realmMatch?.slug ?? target.realm.trim(), name: target.name.trim() };
    const realmLabel = realmMatch?.name ?? target.realm.trim();
    setLoading(true);
    setError(null);
    setAnnouncement("");
    try {
      const params = new URLSearchParams(query);
      const res = await fetch(`/api/collections?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        // A 404 means the searched character doesn't exist, so whatever is
        // still on screen belongs to a *different* character than the one in
        // the search box - clear it rather than leave misleading results (the
        // form, still filled in, shows the error). Transient failures (rate
        // limit, 5xx) keep the previous results and the current mode.
        if (res.status === 404) {
          onScanResult(null);
          setCurrent(null);
          setEditing(false);
        }
        setError(data.error || "Lookup failed");
        return;
      }
      // Show and save the name as the game spells it, whatever was typed. (The
      // cache and "done" keys are lower-cased, so this doesn't change them.)
      const saved = { ...query, name: data.name || formatCharacterName(query.name) };
      const avatar = data.avatar ?? null;
      writeCache(saved, { ...data, avatar });
      onScanResult({
        ownedIds: new Set(data.ownedIds),
        usableIds: data.usableIds ? new Set(data.usableIds) : null,
        faction: data.faction ?? null,
        character: saved,
      });
      setName(saved.name);
      setRealm(realmLabel);
      setCurrent({ region: saved.region, realm: saved.realm, realmName: realmLabel, name: saved.name, avatar });
      setEditing(false);
      setAnnouncement(`Loaded ${data.ownedIds.length} owned mounts for ${saved.name} (${realmLabel}).`);
    } catch {
      setError("Network error, try again.");
    } finally {
      setLoading(false);
    }
  }

  function submitForm(e) {
    e.preventDefault();
    scan({ region, realm, name });
  }

  function rescan(e) {
    e.preventDefault();
    // Put the character back in the form first, so that if it no longer
    // exists (404) the form reappears filled in, ready to correct.
    setRegion(current.region);
    setRealm(current.realmName);
    setName(current.name);
    scan({ region: current.region, realm: current.realm, name: current.name });
  }

  function scanAnother() {
    // Alts are often on the same realm, so keep region + realm.
    setRegion(current.region);
    setRealm(current.realmName);
    setName("");
    setError(null);
    focusNext.current = "name";
    setEditing(true);
  }

  function cancelScanAnother() {
    setError(null);
    focusNext.current = "another";
    setEditing(false);
  }

  const errorLine = error ? <span className="search-status error">{error}</span> : null;

  return (
    <>
      <span className="sr-only search-announcement" role="status" aria-live="polite">
        {announcement}
      </span>
      {showForm ? (
        <form className="search-bar" onSubmit={submitForm}>
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
            ref={nameInputRef}
            placeholder="Character name"
            aria-label="Character name"
            value={name}
            onChange={(e) => {
              clearError();
              setName(e.target.value);
            }}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Scanning..." : "Scan"}
          </button>
          {current ? (
            <button type="button" className="search-cancel" onClick={cancelScanAnother} disabled={loading}>
              Cancel
            </button>
          ) : null}
          {errorLine}
        </form>
      ) : (
        <form className="search-bar scanned" onSubmit={rescan}>
          <div className="search-actions">
            <button type="submit" disabled={loading}>
              {loading ? "Scanning..." : "Rescan"}
            </button>
            <button type="button" ref={anotherButtonRef} onClick={scanAnother} disabled={loading}>
              Scan another character
            </button>
          </div>
          <CharacterPlate character={current} />
          {errorLine}
        </form>
      )}
    </>
  );
}

// "Name-Realm" as the game writes it (realm without spaces: "Name-Area52"),
// with the character's portrait. Falls back to the name's initial when there
// is no portrait yet (older cached scan) or the image fails to load.
function CharacterPlate({ character }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const { name, realmName, avatar } = character;
  const showImage = avatar && failedSrc !== avatar;
  return (
    <div className="character-plate">
      <span className="character-name">
        {name}
        <span className="character-realm">-{realmName.replace(/\s+/g, "")}</span>
      </span>
      {showImage ? (
        <img
          className="character-portrait"
          src={avatar}
          alt=""
          width={56}
          height={56}
          onError={() => setFailedSrc(avatar)}
        />
      ) : (
        <span className="character-portrait placeholder" aria-hidden="true">
          {name.charAt(0)}
        </span>
      )}
    </div>
  );
}
