import { isValidSqsMessage } from './sqs.types';

describe('isValidSqsMessage', () => {
  const validActivityLogged = {
    type: 'ACTIVITY_LOGGED',
    guildId: 'g1',
    userId: 'u1',
    activityName: 'push',
    timestamp: '2025-01-01T00:00:00Z',
    channelId: 'c1',
    interactionToken: 'tok',
    applicationId: 'app1',
  };

  const validBackfill = {
    type: 'BACKFILL_ACTIVITY',
    guildId: 'g1',
    userId: 'u1',
    activityName: 'push',
    date: '2025-01-01',
    channelId: 'c1',
    interactionToken: 'tok',
    applicationId: 'app1',
  };

  it('accepts a valid ACTIVITY_LOGGED message', () => {
    expect(isValidSqsMessage(validActivityLogged)).toBe(true);
  });

  it('accepts a valid BACKFILL_ACTIVITY message', () => {
    expect(isValidSqsMessage(validBackfill)).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidSqsMessage(null)).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(isValidSqsMessage('string')).toBe(false);
  });

  it('rejects unknown type', () => {
    expect(isValidSqsMessage({ ...validActivityLogged, type: 'UNKNOWN' })).toBe(false);
  });

  it('rejects missing type', () => {
    const { type: _type, ...rest } = validActivityLogged;
    expect(isValidSqsMessage(rest)).toBe(false);
  });

  it('rejects missing required field', () => {
    const { guildId: _guildId, ...rest } = validActivityLogged;
    expect(isValidSqsMessage(rest)).toBe(false);
  });

  it('rejects non-string field value', () => {
    expect(isValidSqsMessage({ ...validActivityLogged, userId: 123 })).toBe(false);
  });
});
