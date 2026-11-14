import { ActivityService } from '../activity/activity.service';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { PanelRepository } from './panel.repository';
import { PanelService } from './panel.service';

const mockDelete = jest.fn();
const mockPost = jest.fn();

jest.mock('@discordjs/rest', () => ({
  REST: jest.fn().mockImplementation(() => ({
    setToken: jest.fn().mockReturnThis(),
    delete: (...args: unknown[]) => mockDelete(...args),
    post: (...args: unknown[]) => mockPost(...args),
  })),
}));

describe('PanelService', () => {
  let activityService: jest.Mocked<Pick<ActivityService, 'getActivities' | 'seedDefaults'>>;
  let panelRepository: jest.Mocked<Pick<PanelRepository, 'getChannel' | 'upsertChannel'>>;
  let service: PanelService;

  beforeEach(() => {
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockPost.mockReset().mockResolvedValue({ id: 'new-panel' });

    activityService = {
      getActivities: jest
        .fn()
        .mockResolvedValue([{ name: 'push', displayName: 'Push', emoji: '🫸', isDefault: true }]),
      seedDefaults: jest.fn().mockResolvedValue(undefined),
    };
    panelRepository = {
      getChannel: jest.fn().mockResolvedValue(null),
      upsertChannel: jest.fn().mockResolvedValue(undefined),
    };
    service = new PanelService(
      activityService as unknown as ActivityService,
      panelRepository as unknown as PanelRepository,
      { botToken: 'token' } as DiscordConfigService,
    );
  });

  it('setup seeds the defaults, posts the panel and remembers its message', async () => {
    await service.setup('g1', 'c1');

    expect(activityService.seedDefaults).toHaveBeenCalledWith('g1');
    expect(mockPost).toHaveBeenCalledWith(
      '/channels/c1/messages',
      expect.objectContaining({ body: expect.objectContaining({ components: expect.any(Array) }) }),
    );
    expect(mockDelete).not.toHaveBeenCalled();
    expect(panelRepository.upsertChannel).toHaveBeenCalledWith('g1', 'c1', 'new-panel');
  });

  it('removes the previous panel, looked up from the channel when not passed in', async () => {
    panelRepository.getChannel.mockResolvedValueOnce({
      guildId: 'g1',
      channelId: 'c1',
      lastPanelMessageId: 'old-panel',
    });

    await service.repost('g1', 'c1');

    expect(mockDelete).toHaveBeenCalledWith('/channels/c1/messages/old-panel');
    expect(panelRepository.upsertChannel).toHaveBeenCalledWith('g1', 'c1', 'new-panel');
  });

  it('posts the new panel without waiting for the old one to be removed', async () => {
    let finishDelete!: () => void;
    mockDelete.mockReturnValueOnce(new Promise<void>((resolve) => (finishDelete = resolve)));

    const reposting = service.repost('g1', 'c1', 'old-panel');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPost).toHaveBeenCalledTimes(1); // posted while the delete is still pending
    expect(panelRepository.upsertChannel).not.toHaveBeenCalled(); // but not finished until it is

    finishDelete();
    await reposting;
    expect(panelRepository.upsertChannel).toHaveBeenCalledWith('g1', 'c1', 'new-panel');
  });

  it('carries on when the previous panel cannot be removed', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Unknown Message'));

    await expect(service.repost('g1', 'c1', 'old-panel')).resolves.toBeUndefined();

    expect(panelRepository.upsertChannel).toHaveBeenCalledWith('g1', 'c1', 'new-panel');
  });

  it('fails, without recording a panel, when the new panel cannot be posted', async () => {
    mockPost.mockRejectedValueOnce(new Error('Missing Access'));

    await expect(service.repost('g1', 'c1', 'old-panel')).rejects.toThrow('Missing Access');

    expect(panelRepository.upsertChannel).not.toHaveBeenCalled();
  });
});
