"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import mounts from "@/data/mounts.json";
import farmables from "@/data/farmables.json";
import { resolveFarmables } from "@/lib/farmables";
import { flipTooltip } from "@/lib/tooltipFlip";
import { questLogCollapse } from "@/lib/collapseStore";
import { RESET_SCHEDULES, formatCountdown, getNextReset, getPeriodId } from "@/lib/resets";
import MountIcon from "./MountIcon";
import Toggle from "./Toggle";

// The "Quest Log" tab: mounts the scanned character is missing that drop from
// dungeon, raid and world bosses on a daily/weekly lockout, laid out like the
// in-game quest log - a collapsible list of activities by category on the left,
// the selected activity's objectives / description / mount rewards and its
// Done button on the right. Activity data is data/farmables.json (see
// lib/farmables.js); "done" state is per character, per reset period.

const DONE_KEY_PREFIX = "wow-mount-tracker:done:";
const TICK_MS = 30 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COMPLETED_CATEGORY = "completed";
// Below this width the two panes stack (see .quest-log-frame in globals.css),
// so picking a quest scrolls its details into view.
const STACKED_QUERY = "(max-width: 760px)";

function characterKey(character) {
  if (!character?.name || !character?.realm) return null;
  return `${DONE_KEY_PREFIX}${character.region}:${character.realm.trim().toLowerCase()}:${character.name.trim().toLowerCase()}`;
}

function readDone(key) {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

// Stored as { [activityId]: { cadence, period } } - "done" only counts while
// `period` still equals the current reset period id, so completion expires by
// itself at the server reset without any cleanup pass being required.
function isDone(done, activity, cadence, region, now) {
  const entry = done[activity.id];
  return !!entry && entry.cadence === cadence && entry.period === getPeriodId(region, cadence, now);
}

const pad2 = (n) => String(n).padStart(2, "0");

function lockoutText(cadence, schedule) {
  return cadence === "weekly"
    ? `Loot lockout resets weekly, ${WEEKDAYS[schedule.weeklyDayUtc]} ${pad2(schedule.weeklyHourUtc)}:00 UTC (${schedule.label}).`
    : `Loot lockout resets daily at ${pad2(schedule.dailyHourUtc)}:00 UTC (${schedule.label}).`;
}

export default function QuestLog({ ownedIds, faction, character }) {
  const region = character?.region ?? "us";
  const schedule = RESET_SCHEDULES[region] ?? RESET_SCHEDULES.us;
  const key = characterKey(character);

  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState({});
  const [hideDone, setHideDone] = useState(false);
  const [includeCollected, setIncludeCollected] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const detailRef = useRef(null);

  const collapsedKeys = useSyncExternalStore(
    questLogCollapse.subscribe,
    questLogCollapse.getSnapshot,
    questLogCollapse.getServerSnapshot
  );
  const collapsed = useMemo(() => new Set(collapsedKeys), [collapsedKeys]);

  // Tick so countdowns update and "done" marks clear at the reset boundary,
  // and refresh immediately when the tab regains focus (timers are throttled
  // in background tabs, so a reset may have passed while it was hidden).
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);

  useEffect(() => {
    // Hydrate per-character completion from localStorage (external system).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDone(readDone(key));
  }, [key]);

  const groups = useMemo(
    () => resolveFarmables({ groups: farmables.groups, mounts, ownedIds, faction }),
    [ownedIds, faction]
  );

  // Done activities move out of their category into "Completed this reset" at
  // the bottom of the list; they move back by themselves once their reset
  // period ends.
  const categories = [];
  const completed = [];
  for (const group of groups) {
    const entries = [];
    for (const activity of group.activities) {
      if (!includeCollected && activity.remaining === 0) continue;
      const entry = { activity, cadence: group.cadence };
      if (isDone(done, activity, group.cadence, region, now)) completed.push({ ...entry, done: true });
      else entries.push({ ...entry, done: false });
    }
    if (entries.length > 0) categories.push({ id: group.id, title: group.title, entries });
  }
  if (completed.length > 0 && !hideDone) {
    categories.push({ id: COMPLETED_CATEGORY, title: "Completed this reset", entries: completed });
  }

  // Every quest in list order, for the default selection and for moving on to
  // the next quest when the selected one disappears from the list.
  const flat = categories.flatMap((c) => c.entries);
  const selected = flat.find((e) => e.activity.id === selectedId) ?? flat[0] ?? null;

  let missingMounts = 0;
  let missingActivities = 0;
  let leftThisReset = 0;
  for (const g of groups) {
    for (const a of g.activities) {
      if (a.remaining === 0) continue;
      missingMounts += a.remaining;
      missingActivities += 1;
      if (!isDone(done, a, g.cadence, region, now)) leftThisReset += 1;
    }
  }

  function select(activityId) {
    setSelectedId(activityId);
    if (window.matchMedia(STACKED_QUERY).matches) {
      // Wait for the new details to render before scrolling to them.
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  function setActivityDone(activity, cadence, isNowDone) {
    if (!key) return;
    // With "Hide completed" on, a quest marked done leaves the list, so move
    // the selection on to the quest after it rather than jumping to the top.
    if (isNowDone && hideDone) {
      const i = flat.findIndex((e) => e.activity.id === activity.id);
      const next = flat[i + 1] ?? flat[i - 1];
      if (next) setSelectedId(next.activity.id);
    }
    const nextDone = { ...done };
    // getPeriodId reads the clock itself (not the 30s-stale `now` state) so a
    // click just after a reset is stamped with the new period.
    if (isNowDone) nextDone[activity.id] = { cadence, period: getPeriodId(region, cadence) };
    else delete nextDone[activity.id];
    // Drop entries from past periods while we're writing anyway.
    for (const [id, e] of Object.entries(nextDone)) {
      if (e.period !== getPeriodId(region, e.cadence)) delete nextDone[id];
    }
    setDone(nextDone);
    try {
      localStorage.setItem(key, JSON.stringify(nextDone));
    } catch {
      // Storage unavailable - completion still works for this session.
    }
  }

  const dailyIn = formatCountdown(getNextReset(region, "daily", now) - now);
  const weeklyIn = formatCountdown(getNextReset(region, "weekly", now) - now);

  return (
    <div className="quest-log" onMouseOver={flipTooltip} onFocus={flipTooltip}>
      <p className="quest-log-summary">
        {ownedIds
          ? `${missingMounts} uncollected mounts across ${missingActivities} daily/weekly kills - ${leftThisReset} left this reset`
          : "Scan a character to see only the mounts they're missing. Showing every daily/weekly kill."}
      </p>
      <p className="quest-log-resets">
        {schedule.label} reset: daily in <strong>{dailyIn}</strong>, weekly in <strong>{weeklyIn}</strong>{" "}
        <span className="quest-log-resets-detail">
          (daily {pad2(schedule.dailyHourUtc)}:00 UTC, weekly {WEEKDAYS[schedule.weeklyDayUtc].slice(0, 3)}{" "}
          {pad2(schedule.weeklyHourUtc)}:00 UTC)
        </span>
      </p>
      <div className="filter-bar">
        <Toggle checked={hideDone} onChange={setHideDone}>
          Hide completed
        </Toggle>
        <Toggle checked={includeCollected} disabled={!ownedIds} onChange={setIncludeCollected}>
          Include collected mounts
        </Toggle>
        <div className="filter-group filter-actions">
          <button
            type="button"
            className="filter-button expand"
            onClick={() => questLogCollapse.expandSections(categories.map((c) => c.id))}
          >
            Expand all
          </button>
          <button
            type="button"
            className="filter-button collapse"
            onClick={() => questLogCollapse.collapseSections(categories.map((c) => c.id))}
          >
            Collapse all
          </button>
        </div>
        {!key ? (
          <span className="filter-bar-hint">Scan a character to track completion (saved per character).</span>
        ) : null}
      </div>

      {flat.length === 0 ? (
        <p className="quest-log-empty">
          {completed.length > 0
            ? "All done for this reset."
            : ownedIds && !includeCollected
              ? "Nothing left to farm here - every daily/weekly kill mount is collected."
              : "Nothing to show."}
        </p>
      ) : (
        <div className="quest-log-frame">
          <nav className="quest-list" aria-label="Quests">
            {categories.map((category) => {
              const isCollapsed = collapsed.has(category.id);
              const listId = `quest-category-${category.id}`;
              return (
                <div
                  className={`quest-category${category.id === COMPLETED_CATEGORY ? " completed" : ""}`}
                  key={category.id}
                >
                  <button
                    type="button"
                    className="quest-category-toggle"
                    aria-expanded={!isCollapsed}
                    aria-controls={listId}
                    onClick={() => questLogCollapse.toggleSection(category.id)}
                  >
                    <span className="quest-category-box" aria-hidden="true" />
                    <span className="quest-category-title">{category.title}</span>
                    <span className="quest-category-count">{category.entries.length}</span>
                  </button>
                  {isCollapsed ? null : (
                    <ul className="quest-entries" id={listId}>
                      {category.entries.map((entry) => (
                        <li key={entry.activity.id}>
                          <button
                            type="button"
                            className={`quest-entry${entry.done ? " done" : ""}${
                              ownedIds && entry.activity.remaining === 0 ? " collected" : ""
                            }`}
                            aria-current={entry === selected ? "true" : undefined}
                            onClick={() => select(entry.activity.id)}
                          >
                            <span className="quest-entry-name">{entry.activity.name}</span>
                            {entry.done ? (
                              <span className="quest-entry-status">(Complete)</span>
                            ) : ownedIds && entry.activity.remaining > 1 ? (
                              // Most quests have one missing mount, so only
                              // call out the ones with several.
                              <span className="quest-entry-status" title="Uncollected mounts">
                                {entry.activity.remaining} mounts
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>
          {selected ? (
            <QuestDetail
              ref={detailRef}
              entry={selected}
              ownedIds={ownedIds}
              includeCollected={includeCollected}
              schedule={schedule}
              resetIn={formatCountdown(getNextReset(region, selected.cadence, now) - now)}
              canTrack={!!key}
              onDone={(isNowDone) => setActivityDone(selected.activity, selected.cadence, isNowDone)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function QuestDetail({ ref, entry, ownedIds, includeCollected, schedule, resetIn, canTrack, onDone }) {
  const { activity, cadence, done } = entry;
  const rows = includeCollected ? activity.rows : activity.rows.filter((r) => !r.owned);
  // One objective per boss (a boss can drop several of the listed mounts).
  const objectives = [...new Map(rows.map(({ fm }) => [`${fm.boss}|${fm.difficulty ?? ""}`, fm])).values()];
  const titleId = `quest-title-${activity.id}`;

  return (
    <section className={`quest-detail${done ? " done" : ""}`} ref={ref} aria-labelledby={titleId}>
      <header className="quest-detail-header">
        <h2 className="quest-title" id={titleId}>
          {activity.name}
          {done ? <span className="quest-title-status"> (Complete)</span> : null}
        </h2>
        <p className="quest-tags">
          <span className={`quest-cadence ${cadence}`}>{cadence}</span>
          {activity.confidence === "low" ? (
            <span className="quest-unverified" title="This drop hasn't been confirmed in game yet">
              unverified
            </span>
          ) : null}
        </p>
      </header>

      <h3 className="quest-section-heading">Objectives</h3>
      <ul className="quest-objectives">
        {objectives.map((fm) => (
          <li key={`${fm.boss}|${fm.difficulty ?? ""}`} className={done ? "met" : undefined}>
            {fm.boss} slain{fm.difficulty ? ` (${fm.difficulty})` : ""}: {done ? "1/1" : "0/1"}
          </li>
        ))}
      </ul>

      <h3 className="quest-section-heading">Description</h3>
      <p className="quest-description">
        {activity.zone}, {activity.expansion}.
        {/* "Unspecified in source" is a curation note, not a difficulty. */}
        {activity.difficulty && !/^unspecified/i.test(activity.difficulty) ? ` ${activity.difficulty}.` : ""}
      </p>
      <p className="quest-description">{lockoutText(cadence, schedule)}</p>

      <h3 className="quest-section-heading">Rewards</h3>
      <p className="quest-rewards-intro">You have a chance to receive:</p>
      <ul className="quest-rewards">
        {rows.map(({ fm, mount, owned }) => (
          <li className="quest-reward" key={fm.id}>
            <MountIcon mount={mount} owned={ownedIds ? owned : undefined} />
            <span className="quest-reward-text">
              <span className="quest-reward-name">{mount.name}</span>
              <span className="quest-reward-source">
                {fm.boss}
                {fm.difficulty ? ` - ${fm.difficulty}` : ""}
                {owned ? " · Collected" : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <footer className="quest-detail-footer">
        <span className="quest-reset">
          {done ? "Back in" : "Resets in"} {resetIn}
        </span>
        {done ? (
          <button type="button" className="quest-button undo" onClick={() => onDone(false)}>
            Undo
          </button>
        ) : (
          <button
            type="button"
            className="quest-button"
            disabled={!canTrack}
            title={canTrack ? undefined : "Scan a character to track completion"}
            onClick={() => onDone(true)}
          >
            Done
          </button>
        )}
      </footer>
    </section>
  );
}
