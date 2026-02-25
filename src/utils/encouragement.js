/**
 * Each rule receives context and returns a string message or null.
 *
 * @param {Object} context
 * @param {number} context.currentStreak
 * @param {string} context.activityName
 * @param {string[]} context.recentActivities - activity names for last 7 days (index 0 = today), null for no-log days
 * @param {boolean} context.hadStreakYesterday
 * @returns {string|null}
 */

function comebackAfterMissedDay({ currentStreak, hadStreakYesterday, totalLogs }) {
  // Only fire when user had prior logs (not first-ever) and missed yesterday
  if (currentStreak === 1 && !hadStreakYesterday && totalLogs > 1) {
    return 'Welcome back! Streak reset to 1, but let\'s build it back 💪';
  }
  return null;
}

function consecutiveRest({ recentActivities }) {
  let restDays = 0;
  for (const day of recentActivities) {
    if (day === null) break;
    if (day === 'Rest') {
      restDays++;
    } else {
      break;
    }
  }
  if (restDays >= 3) {
    return `You've been resting for ${restDays} days straight — ready to get back at it? 💪`;
  }
  return null;
}

function firstLog({ currentStreak, totalLogs }) {
  if (currentStreak === 1 && totalLogs === 1) {
    return 'First log! The journey of a thousand days starts with one 🚀';
  }
  return null;
}

const MILESTONES = new Map([
  [7, '🎉 **7-day streak!** One full week, legend!'],
  [14, '🎉 **14-day streak!** Two weeks strong, unstoppable!'],
  [30, '🎉 **30-day streak!** A whole month — you\'re a machine!'],
  [50, '🎉 **50-day streak!** Fifty days of greatness!'],
  [100, '🎉 **100-day streak!** Triple digits — absolute beast!'],
]);

function streakMilestone({ currentStreak }) {
  return MILESTONES.get(currentStreak) || null;
}

/** All rules in priority order. All matching rules fire. */
const rules = [
  comebackAfterMissedDay,
  consecutiveRest,
  firstLog,
  streakMilestone,
];

export default rules;
