"use client";

import { useEffect, useMemo, useState } from "react";
import mounts from "@/data/mounts.json";
import farmables from "@/data/farmables.json";
import { resolveFarmables } from "@/lib/farmables";
import { RESET_SCHEDULES, formatCountdown, getNextReset, getPeriodId } from "@/lib/resets";
import MountIcon from "./MountIcon";

const DONE_KEY_PREFIX = "wow-mount-tracker:done:";
const TICK_MS = 30 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

export default function DailiesView({ ownedIds, faction, character }) {
  const region = character?.region ?? "us";
  const schedule = RESET_SCHEDULES[region] ?? RESET_SCHEDULES.us;
  const key = characterKey(character);

  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState({});
  const [hideDone, setHideDone] = useState(false);
  const [includeCollected, setIncludeCollected] = useState(false);

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

  function toggleDone(activity, cadence, checked) {
    if (!key) return;
    const next = { ...done };
    // getPeriodId reads the clock itself (not the 30s-stale `now` state) so a
    // click just after a reset is stamped with the new period.
    if (checked) next[activity.id] = { cadence, period: getPeriodId(region, cadence) };
    else delete next[activity.id];
    // Drop entries from past periods while we're writing anyway.
    for (const [id, e] of Object.entries(next)) {
      if (e.period !== getPeriodId(region, e.cadence)) delete next[id];
    }
    setDone(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage unavailable - completion still works for this session.
    }
  }

  const groups = useMemo(
    () => resolveFarmables({ groups: farmables.groups, mounts, ownedIds, faction }),
    [ownedIds, faction]
  );

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      activities: group.activities.filter((a) => {
        if (!includeCollected && a.remaining === 0) return false;
        if (hideDone && isDone(done, a, group.cadence, region, now)) return false;
        return true;
      }),
    }))
    .filter((g) => g.activities.length > 0);

  let missingMounts = 0;
  let missingActivities = 0;
  let leftThisReset = 0;
  for (const g of groups) {
    for (const a of g.activities) {
      if (a.remaining === 0) continue;
      missingMounts += a.remaining;
      missingActivities += 1;
      if (!g.eventOnly && !isDone(done, a, g.cadence, region, now)) leftThisReset += 1;
    }
  }

  const dailyIn = formatCountdown(getNextReset(region, "daily", now) - now);
  const weeklyIn = formatCountdown(getNextReset(region, "weekly", now) - now);
  const weeklyDay = WEEKDAYS[schedule.weeklyDayUtc];

  return (
    <div className="dailies">
      <p className="dailies-summary">
        {ownedIds
          ? `${missingMounts} uncollected mounts across ${missingActivities} daily/weekly kills - ${leftThisReset} left this reset`
          : "Scan a character to see only the mounts they're missing. Showing every daily/weekly kill."}
      </p>
      <p className="dailies-resets">
        {schedule.label} reset: daily in <strong>{dailyIn}</strong>, weekly in <strong>{weeklyIn}</strong>{" "}
        <span className="dailies-resets-detail">
          (daily {String(schedule.dailyHourUtc).padStart(2, "0")}:00 UTC, weekly {weeklyDay}{" "}
          {String(schedule.weeklyHourUtc).padStart(2, "0")}:00 UTC)
        </span>
      </p>
      <div className="filter-bar">
        <label>
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide completed
        </label>
        <label className={ownedIds ? "" : "disabled"}>
          <input
            type="checkbox"
            checked={includeCollected}
            disabled={!ownedIds}
            onChange={(e) => setIncludeCollected(e.target.checked)}
          />
          Include collected mounts
        </label>
        {!key ? (
          <span className="filter-bar-hint">Scan a character to track completion (saved per character).</span>
        ) : null}
      </div>

      {visibleGroups.length === 0 ? (
        <p className="dailies-empty">
          {ownedIds && !includeCollected
            ? "Nothing left to farm here - every daily/weekly kill mount is collected."
            : "Nothing to show."}
        </p>
      ) : null}

      {visibleGroups.map((group) => (
        <section className="dailies-group" key={group.id}>
          <h2 className="expansion-heading">{group.title}</h2>
          <div className="farm-card-row">
            {group.activities.map((activity) => {
              const complete = isDone(done, activity, group.cadence, region, now);
              const rows = includeCollected ? activity.rows : activity.rows.filter((r) => !r.owned);
              return (
                <article className={`farm-card${complete ? " done" : ""}`} key={activity.id}>
                  <header className="farm-card-header">
                    <h3 className="farm-card-title">{activity.name}</h3>
                    <span className={`farm-cadence ${group.cadence}`}>{group.cadence}</span>
                  </header>
                  <p className="farm-card-meta">
                    {activity.zone} - {activity.expansion}
                    {activity.confidence === "low" ? (
                      <span className="farm-unverified" title="Not yet verified in game - see docs/farmables-review.md">
                        unverified
                      </span>
                    ) : null}
                  </p>
                  <p className="farm-card-difficulty">{activity.difficulty}</p>
                  <ul className="farm-mounts">
                    {rows.map(({ fm, mount, owned }) => (
                      <li className="farm-mount" key={fm.id}>
                        <MountIcon mount={mount} owned={owned} />
                        <span className="farm-mount-text">
                          <span className="farm-mount-name">{mount.name}</span>
                          <span className="farm-mount-boss">
                            {fm.boss}
                            {fm.difficulty ? ` - ${fm.difficulty}` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {activity.note ? <p className="farm-card-note">{activity.note}</p> : null}
                  <label className={`farm-done${key ? "" : " disabled"}`}>
                    <input
                      type="checkbox"
                      checked={complete}
                      disabled={!key}
                      onChange={(e) => toggleDone(activity, group.cadence, e.target.checked)}
                    />
                    {group.eventOnly ? "Done today" : `Done this ${group.cadence === "daily" ? "day" : "week"}`}
                  </label>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
