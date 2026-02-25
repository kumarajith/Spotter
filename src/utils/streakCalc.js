import { getUserLogDates } from '../database.js';

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Calculate current and best streaks for a user.
 * A streak = consecutive calendar days with any activity logged.
 */
export function calculateStreaks(guildId, userId) {
  const dates = getUserLogDates(guildId, userId); // sorted DESC

  if (dates.length === 0) {
    return { currentStreak: 0, bestStreak: 0 };
  }

  const today = todayUTC();
  const yesterday = addDays(today, -1);

  // Current streak: must include today or yesterday
  let currentStreak = 0;
  if (dates[0] === today || dates[0] === yesterday) {
    currentStreak = 1;
    for (let i = 1; i < dates.length; i++) {
      const expected = addDays(dates[i - 1], -1);
      if (dates[i] === expected) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  // Best streak: find longest consecutive run
  let bestStreak = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const expected = addDays(dates[i - 1], -1);
    if (dates[i] === expected) {
      run++;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 1;
    }
  }

  if (currentStreak > bestStreak) bestStreak = currentStreak;

  return { currentStreak, bestStreak };
}
