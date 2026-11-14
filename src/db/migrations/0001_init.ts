import { Migration } from '../migrate';

/**
 * Every query the app runs is a primary-key prefix scan, so there are no
 * secondary indexes (which on Aurora DSQL would need the non-Postgres
 * `CREATE INDEX ASYNC`).
 */
export const init: Migration = {
  id: '0001_init',
  statements: [
    `CREATE TABLE IF NOT EXISTS activities (
       guild_id     text        NOT NULL,
       name         text        NOT NULL,
       display_name text        NOT NULL,
       emoji        text        NOT NULL DEFAULT '',
       is_default   boolean     NOT NULL DEFAULT false,
       created_by   text        NOT NULL,
       created_at   timestamptz NOT NULL DEFAULT now(),
       removed_at   timestamptz,
       PRIMARY KEY (guild_id, name)
     )`,

    `CREATE TABLE IF NOT EXISTS activity_logs (
       guild_id      text        NOT NULL,
       user_id       text        NOT NULL,
       log_date      date        NOT NULL,
       activity_name text        NOT NULL,
       logged_at     timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (guild_id, user_id, log_date, activity_name)
     )`,

    `CREATE TABLE IF NOT EXISTS tracked_channels (
       guild_id              text        NOT NULL,
       channel_id            text        NOT NULL,
       last_panel_message_id text,
       created_at            timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (guild_id, channel_id)
     )`,

    // Floor for users whose best streak, as stored before v4, is higher than
    // their logs can reproduce. Filled once by the DynamoDB import.
    `CREATE TABLE IF NOT EXISTS legacy_best_streaks (
       guild_id    text    NOT NULL,
       user_id     text    NOT NULL,
       best_streak integer NOT NULL,
       PRIMARY KEY (guild_id, user_id)
     )`,

    // The streak rule, in one place. One row per streak a user has ever had.
    //
    //   days  — one row per logged day; "active" means at least one non-rest log
    //   kinds — consecutive days of the same kind share kind_run (date minus rank is
    //           constant across consecutive dates)
    //   sized — how long each of those same-kind runs is
    //   kept  — drop rest-only runs of 5+ days: they break a streak and count for nothing
    //   runs  — the remaining consecutive days form a streak
    //
    // guild_id and user_id are in every PARTITION BY so a filter on them can be
    // pushed down to the primary-key scan of activity_logs.
    `CREATE OR REPLACE VIEW streak_runs AS
     WITH days AS (
       SELECT guild_id, user_id, log_date,
              bool_or(lower(activity_name) <> 'rest') AS active
       FROM activity_logs
       GROUP BY guild_id, user_id, log_date
     ),
     kinds AS (
       SELECT guild_id, user_id, log_date, active,
              log_date - CAST(RANK() OVER (
                PARTITION BY guild_id, user_id, active ORDER BY log_date
              ) AS integer) AS kind_run
       FROM days
     ),
     sized AS (
       SELECT guild_id, user_id, log_date, active,
              COUNT(*) OVER (PARTITION BY guild_id, user_id, active, kind_run) AS kind_run_length
       FROM kinds
     ),
     kept AS (
       SELECT guild_id, user_id, log_date
       FROM sized
       WHERE active OR kind_run_length < 5
     ),
     runs AS (
       SELECT guild_id, user_id, log_date,
              log_date - CAST(RANK() OVER (
                PARTITION BY guild_id, user_id ORDER BY log_date
              ) AS integer) AS run_id
       FROM kept
     )
     SELECT guild_id, user_id,
            MIN(log_date) AS start_date,
            MAX(log_date) AS end_date,
            CAST(COUNT(*) AS integer) AS length
     FROM runs
     GROUP BY guild_id, user_id, run_id`,
  ],
};
