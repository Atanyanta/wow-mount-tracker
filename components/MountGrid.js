"use client";

import { useMemo, useSyncExternalStore } from "react";
import { groupMounts } from "@/lib/groupMounts";
import { flipTooltip } from "@/lib/tooltipFlip";
import { getServerSnapshot, getSnapshot, subscribe, toggleSection } from "@/lib/collapseStore";
import MountIcon from "./MountIcon";

function PatchBlock({ patch, sources, ownedIds }) {
  return (
    <div className="patch-block">
      <h3 className="patch-heading">{patch}</h3>
      <div className="source-card-row">
        {sources.map(({ source, mounts }, i) => (
          <div className="source-card" key={source ?? i}>
            {source ? <h4 className="source-heading">{source}</h4> : null}
            <div className="mount-grid">
              {mounts.map((mount) => (
                <MountIcon key={mount.id} mount={mount} owned={ownedIds?.has(mount.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// { title -> { owned, total } } across a grouped section list.
function tally(sections, titleKey, ownedIds) {
  const stats = new Map();
  for (const section of sections) {
    let total = 0;
    let owned = 0;
    for (const { sources } of section.patches) {
      for (const { mounts } of sources) {
        for (const m of mounts) {
          total += 1;
          if (ownedIds.has(m.id)) owned += 1;
        }
      }
    }
    stats.set(section[titleKey], { owned, total });
  }
  return stats;
}

// Collapsible section: the heading is a toggle button; the patch blocks are
// only rendered while expanded (keeps the DOM small when most sections are
// folded away). Once a character is scanned, the section's owned/total shows
// as a count beside the heading and/or an XP-style bar - both are always in the
// markup and the "progress" theme option decides which is visible. The bar
// stays visible while collapsed, so a folded section still shows its progress.
function Section({ title, patches, stats, ownedIds, collapsed, crosscut }) {
  const contentId = `section-${title.replace(/\W+/g, "-").toLowerCase()}`;
  const hasStats = stats && stats.total > 0;
  const complete = hasStats && stats.owned === stats.total;
  const pct = hasStats ? Math.round((stats.owned / stats.total) * 100) : 0;

  return (
    <section
      className={`expansion-section${crosscut ? " crosscut-section" : ""}${collapsed ? " collapsed" : ""}`}
    >
      <h2 className="expansion-heading">
        <button
          type="button"
          className="section-toggle"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => toggleSection(title)}
        >
          {title}
          {hasStats ? (
            <span className={`section-count${complete ? " complete" : ""}`}>
              {complete ? "✓ " : ""}
              {stats.owned} / {stats.total}
            </span>
          ) : null}
        </button>
      </h2>
      {hasStats ? (
        <div className={`section-progress${complete ? " complete" : ""}`} aria-hidden="true">
          <span className="bar-fill" style={{ "--pct": `${pct}%` }} />
          <span className="bar-label">
            {complete ? "✓ " : ""}
            {stats.owned} / {stats.total}
          </span>
        </div>
      ) : null}
      {collapsed ? null : (
        <div id={contentId}>
          {patches.map(({ patch, sources }) => (
            <PatchBlock key={patch} patch={patch} sources={sources} ownedIds={ownedIds} />
          ))}
        </div>
      )}
    </section>
  );
}

// `mounts` is what to display (may be filtered); `countMounts` is the full
// obtainable set the per-section counts are computed from, so filtering to
// "Uncollected" doesn't turn every section into 0 / n.
export default function MountGrid({ mounts, ownedIds, countMounts }) {
  const { expansions, crosscutSections } = useMemo(() => groupMounts(mounts), [mounts]);
  const collapsedTitles = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const collapsed = useMemo(() => new Set(collapsedTitles), [collapsedTitles]);

  const { expansionStats, crosscutStats } = useMemo(() => {
    if (!ownedIds || !countMounts) return { expansionStats: null, crosscutStats: null };
    const grouped = groupMounts(countMounts);
    return {
      expansionStats: tally(grouped.expansions, "expansion", ownedIds),
      crosscutStats: tally(grouped.crosscutSections, "title", ownedIds),
    };
  }, [countMounts, ownedIds]);

  return (
    <div onMouseOver={flipTooltip} onFocus={flipTooltip}>
      {expansions.map(({ expansion, patches }) => (
        <Section
          key={expansion}
          title={expansion}
          patches={patches}
          stats={expansionStats?.get(expansion)}
          ownedIds={ownedIds}
          collapsed={collapsed.has(expansion)}
        />
      ))}
      {crosscutSections.map(({ title, patches }) => (
        <Section
          key={title}
          title={title}
          patches={patches}
          stats={crosscutStats?.get(title)}
          ownedIds={ownedIds}
          collapsed={collapsed.has(title)}
          crosscut
        />
      ))}
    </div>
  );
}
