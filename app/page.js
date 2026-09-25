"use client";

import { useCallback, useMemo, useState } from "react";
import mounts from "@/data/mounts.json";
import SearchBar from "@/components/SearchBar";
import FilterBar from "@/components/FilterBar";
import CollectionSummary from "@/components/CollectionSummary";
import MountGrid from "@/components/MountGrid";
import DailiesView from "@/components/DailiesView";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { collapseSections, expandSections } from "@/lib/collapseStore";
import { sectionTitles } from "@/lib/groupMounts";

export default function Home() {
  const [view, setView] = useState("collection"); // "collection" | "dailies"
  const [ownedIds, setOwnedIds] = useState(null);
  const [usableIds, setUsableIds] = useState(null);
  const [faction, setFaction] = useState(null);
  const [character, setCharacter] = useState(null); // { region, realm, name } of the shown scan
  const [filter, setFilter] = useState("all");
  const [showRetired, setShowRetired] = useState(true);

  const handleScanResult = useCallback((result) => {
    setOwnedIds(result ? new Set(result.ownedIds) : null);
    setUsableIds(result?.usableIds ?? null);
    setFaction(result?.faction ?? null);
    setCharacter(result?.character ?? null);
  }, []);

  // Mounts relevant to the scanned character - excludes the opposing
  // faction's mounts (neutral mounts, mount.faction === null, always stay),
  // *unless the character already owns one* - cross-faction mount unlocking
  // means an Alliance character can legitimately own Horde-flagged racial
  // mounts (and vice versa), and a collection tracker must never hide
  // something the player already has. Shared by the grid and the summary
  // count so both agree.
  const relevantMounts = useMemo(() => {
    if (!faction) return mounts;
    const opposing = faction === "alliance" ? "horde" : "alliance";
    return mounts.filter((m) => m.faction !== opposing || ownedIds?.has(m.id));
  }, [faction, ownedIds]);

  const filteredMounts = useMemo(() => {
    let list = showRetired ? relevantMounts : relevantMounts.filter((m) => m.sourceCategory !== "Retired");
    if (!ownedIds || filter === "all") return list;
    if (filter === "collected") return list.filter((m) => ownedIds.has(m.id));
    return list.filter((m) => !ownedIds.has(m.id));
  }, [filter, ownedIds, relevantMounts, showRetired]);

  // The total/collected count excludes mounts that are no longer
  // obtainable at all (sourceCategory "Retired", e.g. Black Qiraji Battle
  // Tank) - counting those in the denominator makes 100% permanently
  // unreachable for anyone who missed them. Any retired mounts the player
  // already has are still surfaced, just as a separate "+n" instead.
  // Sections currently on screen - what Expand all / Collapse all act on.
  const visibleSectionTitles = useMemo(() => sectionTitles(filteredMounts), [filteredMounts]);

  const availableMounts = useMemo(
    () => relevantMounts.filter((m) => m.sourceCategory !== "Retired"),
    [relevantMounts]
  );
  const { total, collected, usable, unobtainableOwned, retiredCount } = useMemo(() => {
    const available = availableMounts;
    const unobtainable = relevantMounts.filter((m) => m.sourceCategory === "Retired");
    return {
      total: available.length,
      retiredCount: unobtainable.length,
      collected: ownedIds ? available.filter((m) => ownedIds.has(m.id)).length : null,
      // Counted over the same mounts as `collected`, so usable <= collected.
      // null when the scan predates usable data (see SearchBar's cache read).
      usable:
        ownedIds && usableIds ? available.filter((m) => usableIds.has(m.id)).length : null,
      unobtainableOwned: ownedIds ? unobtainable.filter((m) => ownedIds.has(m.id)).length : 0,
    };
  }, [relevantMounts, availableMounts, ownedIds, usableIds]);

  return (
    <main>
      <h1>WoW Mount Collection Tracker</h1>
      <div className="view-bar">
        <div className="view-tabs" role="tablist">
          {[
            ["collection", "Collection"],
            ["dailies", "Dailies"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              className={`view-tab${view === value ? " active" : ""}`}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <ThemeSwitcher />
      </div>
      {view === "collection" ? (
        <CollectionSummary
          total={total}
          collected={collected}
          usable={usable}
          unobtainableOwned={unobtainableOwned}
          retiredCount={retiredCount}
        />
      ) : null}
      <SearchBar onScanResult={handleScanResult} />
      {view === "collection" ? (
        <>
          <FilterBar
            filter={filter}
            onFilterChange={setFilter}
            disabled={!ownedIds}
            showRetired={showRetired}
            onShowRetiredChange={setShowRetired}
            onExpandAll={() => expandSections(visibleSectionTitles)}
            onCollapseAll={() => collapseSections(visibleSectionTitles)}
          />
          <MountGrid mounts={filteredMounts} ownedIds={ownedIds} countMounts={availableMounts} />
        </>
      ) : (
        <DailiesView ownedIds={ownedIds} faction={faction} character={character} />
      )}
    </main>
  );
}
