import { SQSEvent } from 'aws-lambda';

// Must mock NestFactory before importing the handler
const mockProcessMessage = jest.fn();
const mockGet = jest.fn().mockReturnValue({ processMessage: mockProcessMessage });
const mockCreateApplicationContext = jest.fn().mockResolvedValue({ get: mockGet });

jest.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: mockCreateApplicationContext },
}));

// Mock Logger to suppress output
jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  return {
    ...actual,
    Logger: jest.fn().mockImplementation(() => ({
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
    })),
  };
});

// Import AFTER mocks are in place — singleton will be shared across tests
import { handler } from './sqs-consumer.handler';

function makeSqsEvent(...bodies: unknown[]): SQSEvent {
  return {
    Records: bodies.map((body, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `rh-${i}`,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      attributes: {} as SQSEvent['Records'][0]['attributes'],
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:000:test',
      awsRegion: 'us-east-1',
    })),
  };
}

const validMsg = {
  type: 'ACTIVITY_LOGGED',
  guildId: 'g1',
  userId: 'u1',
  activityName: 'push',
  timestamp: '2025-01-01T00:00:00Z',
  channelId: 'c1',
  interactionToken: 'tok',
  applicationId: 'app1',
};

describe('sqs-consumer handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-setup the mock return chain (clearAllMocks resets return values)
    mockGet.mockReturnValue({ processMessage: mockProcessMessage });
    mockCreateApplicationContext.mockResolvedValue({ get: mockGet });
  });

  it('processes a valid message', async () => {
    await handler(makeSqsEvent(validMsg), {} as never, () => {});
    expect(mockProcessMessage).toHaveBeenCalledWith(validMsg);
  });

  it('skips invalid messages without throwing', async () => {
    await handler(makeSqsEvent({ type: 'UNKNOWN', bad: true }), {} as never, () => {});
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('processes multiple records sequentially', async () => {
    const backfillMsg = {
      type: 'BACKFILL_ACTIVITY',
      guildId: 'g1',
      userId: 'u1',
      activityName: 'pull',
      date: '2025-01-01',
      channelId: 'c1',
      interactionToken: 'tok',
      applicationId: 'app1',
    };
    await handler(makeSqsEvent(validMsg, backfillMsg), {} as never, () => {});
    expect(mockProcessMessage).toHaveBeenCalledTimes(2);
    expect(mockProcessMessage).toHaveBeenNthCalledWith(1, validMsg);
    expect(mockProcessMessage).toHaveBeenNthCalledWith(2, backfillMsg);
  });

  it('throws on unparseable JSON (triggers Lambda retry)', async () => {
    await expect(handler(makeSqsEvent('not-json'), {} as never, () => {})).rejects.toThrow();
  });
});
