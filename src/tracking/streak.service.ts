import { Injectable } from '@nestjs/common';
import { PendingBreakState, StreakItem } from '../common/types/dynamo.types';
import { StreakRepository } from './streak.repository';

const REST_STREAK_LIMIT = 5;
const REST_ACTIVITY = 'rest';

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function padStreak(n: number): string {
  return n.toString().padStart(5, '0');
}

@Injectable()
export class StreakService {
  constructor(private readonly streakRepository: StreakRepository) {}

  /**
   * Incrementally updates the streak for a single logged activity.
   * Called by the SQS consumer after a successful activity log write.
   */
  async processActivityLogged(
    guildId: string,
    userId: string,
    activityName: string,
    date: string,
  ): Promise<{ currentStreak: number }> {
    const existing = await this.streakRepository.getStreak(guildId, userId);
    const isRest = activityName.toLowerCase() === REST_ACTIVITY;

    let currentStreak: number;
    let longestStreak: number;
    let consecutiveRestOnlyDays: number;
    let lastDayHasNonRest: boolean;
    let pendingBreakState: PendingBreakState | undefined;

    if (!existing || date > addDays(existing.lastLoggedDate, 1)) {
      // ── Case A: gap or new user ──────────────────────────────────────────────
      currentStreak = 1;
      consecutiveRestOnlyDays = isRest ? 1 : 0;
      lastDayHasNonRest = !isRest;
      pendingBreakState = undefined;
      longestStreak = Math.max(1, existing?.longestStreak ?? 0);
    } else if (date === addDays(existing.lastLoggedDate, 1)) {
      // ── Case B: consecutive new day ──────────────────────────────────────────
      pendingBreakState = undefined; // confirm previous day's pending break (if any)

      if (existing.currentStreak === 0) {
        // Post-break fresh start — treat identically to Case A
        currentStreak = 1;
        consecutiveRestOnlyDays = isRest ? 1 : 0;
        lastDayHasNonRest = !isRest;
      } else if (isRest) {
        const newConsecutive = existing.consecutiveRestOnlyDays + 1;

        if (newConsecutive >= REST_STREAK_LIMIT) {
          // Limit hit: snapshot pre-break state so same-day Push can restore it, then reset.
          // The legacy countRun formula (streak - (consecutiveRest - 1)) only works because
          // streak at that point only contains the rest days iterated so far — it never reaches
          // the non-rest days behind them. In the incremental model currentStreak includes
          // the full accumulated history, so the correct equivalent is simply 0.
          pendingBreakState = {
            preBreakStreak: existing.currentStreak,
            preBreakConsecutiveRest: existing.consecutiveRestOnlyDays,
          };
          currentStreak = 0;
          consecutiveRestOnlyDays = newConsecutive;
          lastDayHasNonRest = false;
        } else {
          currentStreak = existing.currentStreak + 1;
          consecutiveRestOnlyDays = newConsecutive;
          lastDayHasNonRest = false;
        }
      } else {
        // Non-rest: extend streak, reset rest chain
        currentStreak = existing.currentStreak + 1;
        consecutiveRestOnlyDays = 0;
        lastDayHasNonRest = true;
      }

      longestStreak = Math.max(currentStreak, existing.longestStreak);
    } else {
      // ── Case C: same day ─────────────────────────────────────────────────────
      currentStreak = existing.currentStreak;
      consecutiveRestOnlyDays = existing.consecutiveRestOnlyDays;
      lastDayHasNonRest = existing.lastDayHasNonRest;
      pendingBreakState = existing.pendingBreakState;
      longestStreak = existing.longestStreak;

      if (!isRest && !existing.lastDayHasNonRest) {
        if (existing.pendingBreakState) {
          // Rest hit the limit earlier today; Push undoes it
          currentStreak = existing.pendingBreakState.preBreakStreak + 1;
          consecutiveRestOnlyDays = 0;
          pendingBreakState = undefined;
        } else {
          // Rest didn't hit limit; un-count today from the rest chain
          consecutiveRestOnlyDays = Math.max(0, existing.consecutiveRestOnlyDays - 1);
        }
        lastDayHasNonRest = true;
        longestStreak = Math.max(currentStreak, existing.longestStreak);
      }
      // else: no-op — day already correctly counted
    }

    const updated: StreakItem = {
      PK: `GUILD#${guildId}`,
      SK: `STREAK#${userId}`,
      GSI1PK: `LEADERBOARD#${guildId}`,
      GSI1SK: `STREAK#${padStreak(currentStreak)}`,
      guildId,
      userId,
      currentStreak,
      longestStreak,
      currentStreakPadded: padStreak(currentStreak),
      lastLoggedDate: date,
      updatedAt: new Date().toISOString(),
      entityType: 'STREAK',
      consecutiveRestOnlyDays,
      lastDayHasNonRest,
      ...(pendingBreakState !== undefined && { pendingBreakState }),
    };

    await this.streakRepository.putStreak(updated);
    return { currentStreak };
  }

  /**
   * Recomputes the full streak from all historical logs.
   * Used for backfill — overwrites the incremental state with ground-truth values.
   * Ports the legacy calculateStreaks / countRun / buildDateMap algorithm.
   */
  async recomputeStreak(
    guildId: string,
    userId: string,
  ): Promise<{ currentStreak: number; longestStreak: number }> {
    const existing = await this.streakRepository.getStreak(guildId, userId);
    const logs = await this.streakRepository.getUserLogs(guildId, userId);

    if (logs.length === 0) {
      return { currentStreak: 0, longestStreak: existing?.longestStreak ?? 0 };
    }

    const dateMap = this.buildDateMap(logs);
    // Unique dates DESC (logs are already DESC from the query)
    const allDates = [...new Set(logs.map((r) => r.date))];

    const { currentStreak, bestStreak } = this.calculateStreaks(dateMap, allDates);
    // Preserve historically computed longestStreak — logs from before the current
    // continuous history may no longer exist but the stored value is still valid
    const longestStreak = Math.max(bestStreak, existing?.longestStreak ?? 0);

    // Derive incremental fields from the current streak run
    const { consecutiveRestOnlyDays, lastDayHasNonRest } = this.deriveIncrementalState(
      dateMap,
      allDates,
      currentStreak,
    );

    const updated: StreakItem = {
      PK: `GUILD#${guildId}`,
      SK: `STREAK#${userId}`,
      GSI1PK: `LEADERBOARD#${guildId}`,
      GSI1SK: `STREAK#${padStreak(currentStreak)}`,
      guildId,
      userId,
      currentStreak,
      longestStreak,
      currentStreakPadded: padStreak(currentStreak),
      lastLoggedDate: allDates[0], // most recent date (DESC)
      updatedAt: new Date().toISOString(),
      entityType: 'STREAK',
      consecutiveRestOnlyDays,
      lastDayHasNonRest,
      // no pendingBreakState after a full recompute
    };

    await this.streakRepository.putStreak(updated);
    return { currentStreak, longestStreak };
  }

  // ── Private: ported from legacy/src/utils/streakCalc.js ────────────────────

  private buildDateMap(
    logs: Array<{ date: string; activityName: string }>,
  ): Map<string, { hasNonRest: boolean }> {
    const map = new Map<string, { hasNonRest: boolean }>();
    for (const row of logs) {
      if (!map.has(row.date)) {
        map.set(row.date, { hasNonRest: false });
      }
      if (row.activityName.toLowerCase() !== REST_ACTIVITY) {
        map.get(row.date)!.hasNonRest = true;
      }
    }
    return map;
  }

  /** Counts a streak run over a DESC-sorted array of consecutive dates. */
  private countRun(dates: string[], dateMap: Map<string, { hasNonRest: boolean }>): number {
    let streak = 0;
    let consecutiveRest = 0;

    for (const date of dates) {
      const info = dateMap.get(date);
      if (!info) break; // date missing — gap

      if (info.hasNonRest) {
        consecutiveRest = 0;
      } else {
        consecutiveRest++;
        if (consecutiveRest >= REST_STREAK_LIMIT) {
          streak = Math.max(0, streak - (consecutiveRest - 1));
          break;
        }
      }
      streak++;
    }

    return streak;
  }

  private calculateStreaks(
    dateMap: Map<string, { hasNonRest: boolean }>,
    allDates: string[], // unique dates, DESC
  ): { currentStreak: number; bestStreak: number } {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = addDays(today, -1);

    // Current streak must be anchored to today or yesterday
    let currentStreak = 0;
    if (allDates[0] === today || allDates[0] === yesterday) {
      const consecutive: string[] = [allDates[0]];
      for (let i = 1; i < allDates.length; i++) {
        if (allDates[i] === addDays(allDates[i - 1], -1)) {
          consecutive.push(allDates[i]);
        } else {
          break;
        }
      }
      currentStreak = this.countRun(consecutive, dateMap);
    }

    // Best streak: scan all consecutive runs
    let bestStreak = 0;
    let runStart = 0;
    while (runStart < allDates.length) {
      const consecutive: string[] = [allDates[runStart]];
      for (let i = runStart + 1; i < allDates.length; i++) {
        if (allDates[i] === addDays(allDates[i - 1], -1)) {
          consecutive.push(allDates[i]);
        } else {
          break;
        }
      }
      const run = this.countRun(consecutive, dateMap);
      if (run > bestStreak) bestStreak = run;
      runStart += consecutive.length;
    }

    return { currentStreak, bestStreak: Math.max(currentStreak, bestStreak) };
  }

  /**
   * Derives incrementalstate fields from the current streak's trailing dates.
   * Walks the tail of the current streak run (DESC) to count consecutive rest-only days.
   */
  private deriveIncrementalState(
    dateMap: Map<string, { hasNonRest: boolean }>,
    allDates: string[], // DESC
    currentStreak: number,
  ): { consecutiveRestOnlyDays: number; lastDayHasNonRest: boolean } {
    const lastDayHasNonRest = dateMap.get(allDates[0])?.hasNonRest ?? false;

    let consecutiveRestOnlyDays = 0;
    for (let i = 0; i < currentStreak && i < allDates.length; i++) {
      const info = dateMap.get(allDates[i]);
      if (info?.hasNonRest) break; // hit a non-rest day — stop counting
      consecutiveRestOnlyDays++;
    }

    return { consecutiveRestOnlyDays, lastDayHasNonRest };
  }
}
