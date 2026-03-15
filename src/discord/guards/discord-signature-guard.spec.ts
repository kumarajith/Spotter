import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DiscordSignatureGuard } from './discord-signature-guard';
import { DiscordConfigService } from '../../common/config/discord-config-service';
import * as discordInteractions from 'discord-interactions';

jest.mock('discord-interactions', () => ({
  verifyKey: jest.fn(),
}));

describe('DiscordSignatureGuard', () => {
  let guard: DiscordSignatureGuard;
  const mockVerifyKey = discordInteractions.verifyKey as jest.MockedFunction<
    typeof discordInteractions.verifyKey
  >;

  beforeEach(async () => {
    mockVerifyKey.mockClear();

    const module = await Test.createTestingModule({
      providers: [
        DiscordSignatureGuard,
        {
          provide: DiscordConfigService,
          useValue: { publicKey: 'test-public-key' },
        },
      ],
    }).compile();

    guard = module.get(DiscordSignatureGuard);
  });

  function makeContext(headers: Record<string, string | undefined>, rawBody?: Buffer) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          rawBody,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('returns true when signature is valid', async () => {
    mockVerifyKey.mockReturnValue(true);
    const ctx = makeContext(
      { 'x-signature-ed25519': 'sig', 'x-signature-timestamp': '123' },
      Buffer.from('body'),
    );
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(mockVerifyKey).toHaveBeenCalledWith(
      Buffer.from('body'),
      'sig',
      '123',
      'test-public-key',
    );
  });

  it('returns false when headers are missing', async () => {
    const ctx = makeContext({});
    expect(await guard.canActivate(ctx)).toBe(false);
    expect(mockVerifyKey).not.toHaveBeenCalled();
  });

  it('returns false when rawBody is missing', async () => {
    const ctx = makeContext({
      'x-signature-ed25519': 'sig',
      'x-signature-timestamp': '123',
    });
    expect(await guard.canActivate(ctx)).toBe(false);
  });
});
