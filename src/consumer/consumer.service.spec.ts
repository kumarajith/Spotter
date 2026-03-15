import { Test, TestingModule } from '@nestjs/testing';
import { ConsumerService } from './consumer.service';
import { TrackingRepository } from '../tracking/tracking.repository';
import { StreakService } from '../tracking/streak.service';
import { ActivityLoggedMessage, BackfillActivityMessage } from '../common/types/sqs.types';

function mockFetchResponse(ok: boolean, status = ok ? 200 : 500): Response {
  return { ok, status, statusText: ok ? 'OK' : 'Error' } as Response;
}

describe('ConsumerService', () => {
  let service: ConsumerService;
  let trackingRepository: jest.Mocked<TrackingRepository>;
  let streakService: jest.Mocked<StreakService>;
  let fetchSpy: jest.SpyInstance;

  const baseActivityMsg: ActivityLoggedMessage = {
    type: 'ACTIVITY_LOGGED',
    guildId: 'guild-1',
    userId: 'user-1',
    activityName: 'push',
    timestamp: '2026-03-15T10:00:00.000Z',
    channelId: 'channel-1',
    interactionToken: 'token-abc',
    applicationId: 'app-123',
  };

  const baseBackfillMsg: BackfillActivityMessage = {
    type: 'BACKFILL_ACTIVITY',
    guildId: 'guild-1',
    userId: 'user-1',
    activityName: 'pull',
    date: '2026-03-14',
    channelId: 'channel-1',
    interactionToken: 'token-def',
    applicationId: 'app-123',
  };

  beforeEach(async () => {
    process.env.DISCORD_BOT_TOKEN = 'test-token';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsumerService,
        {
          provide: TrackingRepository,
          useValue: {
            logActivity: jest.fn(),
          },
        },
        {
          provide: StreakService,
          useValue: {
            processActivityLogged: jest.fn(),
            recomputeStreak: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ConsumerService);
    trackingRepository = module.get(TrackingRepository);
    streakService = module.get(StreakService);

    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(true));
  });

  afterEach(() => {
    delete process.env.DISCORD_BOT_TOKEN;
    fetchSpy.mockRestore();
  });

  // ─── ACTIVITY_LOGGED ────────────────────────────────────────────────

  it('ACTIVITY_LOGGED happy path: logs activity, updates streak, sends channel message, deletes original', async () => {
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: false });
    streakService.processActivityLogged.mockResolvedValue({ currentStreak: 5 });

    await service.processMessage(baseActivityMsg);

    expect(trackingRepository.logActivity).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'push',
      '2026-03-15',
    );
    expect(streakService.processActivityLogged).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'push',
      '2026-03-15',
    );

    // Two fetch calls: channel message + delete original
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Channel message
    const [channelUrl, channelOpts] = fetchSpy.mock.calls[0];
    expect(channelUrl).toBe('https://discord.com/api/v10/channels/channel-1/messages');
    expect(channelOpts.method).toBe('POST');
    expect(JSON.parse(channelOpts.body).content).toContain('<@user-1> logged **Push**');

    // Delete original
    const [deleteUrl, deleteOpts] = fetchSpy.mock.calls[1];
    expect(deleteUrl).toContain('/webhooks/app-123/token-abc/messages/@original');
    expect(deleteOpts.method).toBe('DELETE');
  });

  it('ACTIVITY_LOGGED already logged: sends followup, does NOT call processActivityLogged', async () => {
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: true });

    await service.processMessage(baseActivityMsg);

    expect(trackingRepository.logActivity).toHaveBeenCalled();
    expect(streakService.processActivityLogged).not.toHaveBeenCalled();

    // Only one fetch call: the followup
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://discord.com/api/v10/webhooks/app-123/token-abc');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.content).toContain('Already logged');
    expect(body.flags).toBe(64);
  });

  // ─── BACKFILL_ACTIVITY ──────────────────────────────────────────────

  it('BACKFILL_ACTIVITY happy path: logs activity, recomputes streak, sends channel message, deletes original', async () => {
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: false });
    streakService.recomputeStreak.mockResolvedValue({ currentStreak: 3, longestStreak: 10 });

    await service.processMessage(baseBackfillMsg);

    expect(trackingRepository.logActivity).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'pull',
      '2026-03-14',
    );
    expect(streakService.recomputeStreak).toHaveBeenCalledWith('guild-1', 'user-1');

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Channel message
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.content).toContain('backfilled **Pull** for 2026-03-14');
  });

  it('BACKFILL_ACTIVITY already logged: sends followup warning, does NOT recompute streak', async () => {
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: true });

    await service.processMessage(baseBackfillMsg);

    expect(streakService.recomputeStreak).not.toHaveBeenCalled();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.content).toContain('already logged');
    expect(body.content).toContain('Pull');
    expect(body.content).toContain('2026-03-14');
  });

  // ─── Streak suffix logic ───────────────────────────────────────────

  it('ACTIVITY_LOGGED includes streak suffix when currentStreak > 0', async () => {
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: false });
    streakService.processActivityLogged.mockResolvedValue({ currentStreak: 7 });

    await service.processMessage(baseActivityMsg);

    const channelBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(channelBody.content).toContain('7-day');
    expect(channelBody.content).toContain('streak');
  });

  it('ACTIVITY_LOGGED omits streak suffix when currentStreak === 0', async () => {
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: false });
    streakService.processActivityLogged.mockResolvedValue({ currentStreak: 0 });

    await service.processMessage(baseActivityMsg);

    const channelBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(channelBody.content).toBe('<@user-1> logged **Push**');
  });

  // ─── sendChannelMessage errors ─────────────────────────────────────

  it('throws when DISCORD_BOT_TOKEN is missing', async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: false });
    streakService.processActivityLogged.mockResolvedValue({ currentStreak: 1 });

    await expect(service.processMessage(baseActivityMsg)).rejects.toThrow(
      'DISCORD_BOT_TOKEN is not set',
    );
  });

  it('sendChannelMessage throws on non-ok response', async () => {
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: false });
    streakService.processActivityLogged.mockResolvedValue({ currentStreak: 1 });

    // First fetch (channel message) returns 403
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(false, 403));

    await expect(service.processMessage(baseActivityMsg)).rejects.toThrow(
      'Channel message failed [403]',
    );
  });

  // ─── sendFollowup errors ───────────────────────────────────────────

  it('sendFollowup throws on non-ok response', async () => {
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: true });

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(false, 500));

    await expect(service.processMessage(baseActivityMsg)).rejects.toThrow(
      'Discord followup failed [500]',
    );
  });

  // ─── deleteOriginalResponse resilience ─────────────────────────────

  it('deleteOriginalResponse does NOT throw on non-ok response', async () => {
    trackingRepository.logActivity.mockResolvedValue({ alreadyLogged: false });
    streakService.processActivityLogged.mockResolvedValue({ currentStreak: 1 });

    // Channel message succeeds, delete fails
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse(true)) // channel message
      .mockResolvedValueOnce(mockFetchResponse(false, 404)); // delete original

    // Should resolve without throwing
    await expect(service.processMessage(baseActivityMsg)).resolves.toBeUndefined();
  });
});
