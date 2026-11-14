import { Db } from '../db/db';
import { createTestDb, uniqueGuildId } from '../db/test-db';
import { PanelRepository } from './panel.repository';

describe('PanelRepository', () => {
  let db: Db;
  let panels: PanelRepository;
  let guildId: string;

  beforeAll(async () => {
    db = await createTestDb();
    panels = new PanelRepository(db);
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(() => {
    guildId = uniqueGuildId();
  });

  it('returns null for a channel that was never set up', async () => {
    expect(await panels.getChannel(guildId, 'c1')).toBeNull();
  });

  it('remembers the latest panel message per channel', async () => {
    await panels.upsertChannel(guildId, 'c1', 'm1');
    await panels.upsertChannel(guildId, 'c1', 'm2');

    expect(await panels.getChannel(guildId, 'c1')).toEqual({
      guildId,
      channelId: 'c1',
      lastPanelMessageId: 'm2',
    });
  });

  it('lists tracked channels across guilds', async () => {
    const otherGuild = uniqueGuildId();
    await panels.upsertChannel(guildId, 'c1', 'm1');
    await panels.upsertChannel(otherGuild, 'c2', 'm2');

    const all = await panels.getAllTrackedChannels();

    expect(all).toEqual(
      expect.arrayContaining([
        { guildId, channelId: 'c1', lastPanelMessageId: 'm1' },
        { guildId: otherGuild, channelId: 'c2', lastPanelMessageId: 'm2' },
      ]),
    );
  });
});
