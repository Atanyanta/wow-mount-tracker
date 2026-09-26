// Server reset schedules per Blizzard region, used to auto-expire "done"
// checkmarks on the Quest Log tab (lib/farmables.js has the activity data).
//
// Times are treated as FIXED IN UTC, per the sources I could verify (a
// Blizzard forum PSA on the DST change and two reset-timer sites: local time
// shifts by an hour with DST, the UTC instant does not). One site
// (vaultalts.com) claims the opposite (pinned to local server time), so if
// resets ever look an hour off after a DST change, this table is the only
// place to adjust. Check in game with:
//   /run print(C_DateAndTime.GetSecondsUntilDailyReset(), C_DateAndTime.GetSecondsUntilWeeklyReset())
//
//   US (incl. Oceanic/LatAm): daily 15:00 UTC, weekly Tuesday 15:00 UTC
//   EU:                       daily 04:00 UTC, weekly Wednesday 04:00 UTC
//   KR / TW:                  daily 23:00 UTC, weekly Wednesday 23:00 UTC
//                             (= Thursday 07:00 in Taiwan)
// weeklyDayUtc uses JS getUTCDay numbering (0 = Sunday ... 6 = Saturday).

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const EPOCH_UTC_DAY = 4; // 1970-01-01 was a Thursday

export const RESET_SCHEDULES = {
  us: { dailyHourUtc: 15, weeklyDayUtc: 2, weeklyHourUtc: 15, label: "US" },
  eu: { dailyHourUtc: 4, weeklyDayUtc: 3, weeklyHourUtc: 4, label: "EU" },
  kr: { dailyHourUtc: 23, weeklyDayUtc: 3, weeklyHourUtc: 23, label: "KR" },
  tw: { dailyHourUtc: 23, weeklyDayUtc: 3, weeklyHourUtc: 23, label: "TW" },
};

function scheduleFor(region) {
  return RESET_SCHEDULES[region] ?? RESET_SCHEDULES.us;
}

// Milliseconds after the Unix epoch at which period 0 of a cadence starts,
// and that cadence's length.
function periodParams(region, cadence) {
  const s = scheduleFor(region);
  if (cadence === "weekly") {
    const dayOffset = (s.weeklyDayUtc - EPOCH_UTC_DAY + 7) % 7;
    return { origin: dayOffset * DAY + s.weeklyHourUtc * HOUR, length: WEEK };
  }
  return { origin: s.dailyHourUtc * HOUR, length: DAY };
}

// Integer id of the reset period `now` falls in. Two timestamps in the same
// period share an id, so "done in period N" naturally expires at the reset.
export function getPeriodId(region, cadence, now = Date.now()) {
  const { origin, length } = periodParams(region, cadence);
  return Math.floor((now - origin) / length);
}

// Epoch ms of the next reset after `now`.
export function getNextReset(region, cadence, now = Date.now()) {
  const { origin, length } = periodParams(region, cadence);
  return (getPeriodId(region, cadence, now) + 1) * length + origin;
}

export function formatCountdown(ms) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
