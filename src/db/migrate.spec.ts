import { Db } from './db';
import { runMigrations } from './migrate';
import { PgliteDb } from './pglite';

describe('runMigrations', () => {
  let db: Db;

  beforeAll(() => {
    db = new PgliteDb();
  });

  afterAll(async () => {
    await db.end();
  });

  it('applies every migration on a fresh database, then nothing on the next run', async () => {
    expect(await runMigrations(db)).toEqual(['0001_init']);
    expect(await runMigrations(db)).toEqual([]);

    const recorded = await db.query('SELECT id FROM schema_migrations');
    expect(recorded).toEqual([{ id: '0001_init' }]);
  });

  it('creates the tables and the streak view', async () => {
    for (const relation of [
      'activities',
      'activity_logs',
      'tracked_channels',
      'legacy_best_streaks',
      'streak_runs',
    ]) {
      await expect(db.query(`SELECT * FROM ${relation} LIMIT 0`)).resolves.toEqual([]);
    }
  });

  it('re-runs a half-applied migration from its first statement', async () => {
    const fresh = new PgliteDb();
    const failing = {
      id: '0001_broken',
      statements: ['CREATE TABLE IF NOT EXISTS t (id text PRIMARY KEY)', 'SELECT * FROM missing'],
    };
    await expect(runMigrations(fresh, [failing])).rejects.toThrow(/missing/);
    expect(await fresh.query('SELECT id FROM schema_migrations')).toEqual([]);

    const fixed = { id: '0001_broken', statements: [failing.statements[0], 'SELECT 1'] };
    expect(await runMigrations(fresh, [fixed])).toEqual(['0001_broken']);
    await fresh.end();
  });
});
