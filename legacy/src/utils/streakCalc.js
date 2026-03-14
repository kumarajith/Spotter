import { getUserLogDatesWithActivities } from '../database.js';
import { REST_STREAK_LIMIT } from '../defaults.js';

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Group raw log rows into a Map of date -> { isRestOnly: boolean }.
 */
function buildDateMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.logged_date)) {
      map.set(row.logged_date, { hasNonRest: false });
    }
    if (row.activity_name !== 'Rest') {
      map.get(row.logged_date).hasNonRest = true;
    }
  }
  return map;
}

/**
 * Count a streak run from a list of consecutive dates,
 * breaking if consecutive rest-only days reach REST_STREAK_LIMIT.
 * Returns the valid streak length.
 */
function countRun(dates, dateMap) {
  let streak = 0;
  let consecutiveRest = 0;

  for (const date of dates) {
    const info = dateMap.get(date);
    if (!info) break;

    if (info.hasNonRest) {
      consecutiveRest = 0;
    } else {
      consecutiveRest++;
      if (consecutiveRest >= REST_STREAK_LIMIT) {
        // Subtract the rest-only days that hit the limit
        streak = streak - (consecutiveRest - 1);
        if (streak < 0) streak = 0;
        break;
      }
    }
    streak++;
  }

  return streak;
}

/**
 * Calculate current and best streaks for a user.
 * A streak = consecutive calendar days with any activity logged,
 * but resets if REST_STREAK_LIMIT consecutive days are rest-only.
 */
export function calculateStreaks(guildId, userId) {
  const rows = getUserLogDatesWithActivities(guildId, userId); // sorted DESC

  if (rows.length === 0) {
    return { currentStreak: 0, bestStreak: 0 };
  }

  const dateMap = buildDateMap(rows);
  const allDates = [...new Set(rows.map(r => r.logged_date))]; // sorted DESC (from query)

  const today = todayUTC();
  const yesterday = addDays(today, -1);

  // Current streak: must include today or yesterday
  let currentStreak = 0;
  if (allDates[0] === today || allDates[0] === yesterday) {
    // Build consecutive date list from most recent
    const consecutive = [allDates[0]];
    for (let i = 1; i < allDates.length; i++) {
      const expected = addDays(allDates[i - 1], -1);
      if (allDates[i] === expected) {
        consecutive.push(allDates[i]);
      } else {
        break;
      }
    }
    currentStreak = countRun(consecutive, dateMap);
  }

  // Best streak: check all consecutive runs
  let bestStreak = 0;
  let runStart = 0;
  while (runStart < allDates.length) {
    const consecutive = [allDates[runStart]];
    for (let i = runStart + 1; i < allDates.length; i++) {
      const expected = addDays(allDates[i - 1], -1);
      if (allDates[i] === expected) {
        consecutive.push(allDates[i]);
      } else {
        break;
      }
    }
    const run = countRun(consecutive, dateMap);
    if (run > bestStreak) bestStreak = run;
    runStart += consecutive.length;
  }

  if (currentStreak > bestStreak) bestStreak = currentStreak;

  return { currentStreak, bestStreak };
}
