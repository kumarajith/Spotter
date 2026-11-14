import { Db } from '../db/db';
import { createTestDb, uniqueGuildId } from '../db/test-db';
import { DEFAULT_ACTIVITIES } from './activity.defaults';
import { ActivityRepository } from './activity.repository';

describe('ActivityRepository', () => {
  let db: Db;
  let activities: ActivityRepository;
  let guildId: string;

  beforeAll(async () => {
    db = await createTestDb();
    activities = new ActivityRepository(db);
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(() => {
    guildId = uniqueGuildId();
  });

  it('lists activities by name, keyed by the lowercased display name', async () => {
    await activities.putActivity(guildId, 'Yoga', '🧘', false, 'u1');
    await activities.putActivity(guildId, 'Climb', '🧗', false, 'u1');

    expect(await activities.getActivities(guildId)).toEqual([
      { name: 'climb', displayName: 'Climb', emoji: '🧗', isDefault: false },
      { name: 'yoga', displayName: 'Yoga', emoji: '🧘', isDefault: false },
    ]);
  });

  it('refuses a second activity with the same name, whatever the casing', async () => {
    expect(await activities.putActivity(guildId, 'Yoga', '🧘', false, 'u1')).toBe(true);
    expect(await activities.putActivity(guildId, 'YOGA', '🔥', false, 'u2')).toBe(false);

    expect(await activities.getActivities(guildId)).toEqual([
      expect.objectContaining({ displayName: 'Yoga', emoji: '🧘' }),
    ]);
  });

  it('removing hides the activity but keeps its row for history', async () => {
    await activities.putActivity(guildId, 'Yoga', '🧘', false, 'u1');

    await activities.deleteActivity(guildId, 'yoga');

    expect(await activities.getActivities(guildId)).toEqual([]);
    const kept = await db.query(
      'SELECT emoji FROM activities WHERE guild_id = $1 AND removed_at IS NOT NULL',
      [guildId],
    );
    expect(kept).toEqual([{ emoji: '🧘' }]);
  });

  it('adding a removed activity again brings it back with the new details', async () => {
    await activities.putActivity(guildId, 'Yoga', '🧘', false, 'u1');
    await activities.deleteActivity(guildId, 'Yoga');

    expect(await activities.putActivity(guildId, 'yoga', '🪷', false, 'u2')).toBe(true);

    expect(await activities.getActivities(guildId)).toEqual([
      { name: 'yoga', displayName: 'yoga', emoji: '🪷', isDefault: false },
    ]);
  });

  it('seeding defaults is repeatable and restores removed defaults', async () => {
    await activities.seedDefaults(guildId);
    await activities.deleteActivity(guildId, 'Walk');
    await activities.seedDefaults(guildId);

    const listed = await activities.getActivities(guildId);
    expect(listed.map((a) => a.name).sort()).toEqual(DEFAULT_ACTIVITIES.map((a) => a.name).sort());
    expect(listed.every((a) => a.isDefault)).toBe(true);
  });
});
