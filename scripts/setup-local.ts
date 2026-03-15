import 'dotenv/config';
import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import {
  CreateQueueCommand,
  GetQueueUrlCommand,
  QueueDoesNotExist,
  SQSClient,
} from '@aws-sdk/client-sqs';

const LOCAL_CREDENTIALS = { accessKeyId: 'local', secretAccessKey: 'local' };

async function setupDynamo() {
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:4566';
  const tableName = process.env.TABLE_NAME ?? 'spotter-dev';

  const client = new DynamoDBClient({
    endpoint,
    region: 'us-east-1',
    credentials: LOCAL_CREDENTIALS,
  });

  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );
    console.log(`✅ Table "${tableName}" created at ${endpoint}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`ℹ️  Table "${tableName}" already exists — skipping.`);
      return;
    }
    throw err;
  }
}

async function setupSqs() {
  const queueUrl = process.env.QUEUE_URL;
  if (!queueUrl) {
    console.log('⚠️  QUEUE_URL not set — skipping SQS setup.');
    return;
  }

  const { hostname, origin } = new URL(queueUrl);
  if (hostname.includes('amazonaws.com')) {
    console.log('ℹ️  QUEUE_URL points to AWS — skipping local SQS setup.');
    return;
  }

  // Extract queue name from the URL path: http://localhost:4566/000000000000/queue-name
  const queueName = queueUrl.split('/').at(-1);
  if (!queueName) throw new Error(`Could not parse queue name from QUEUE_URL: ${queueUrl}`);

  const client = new SQSClient({
    endpoint: origin,
    region: 'us-east-1',
    credentials: LOCAL_CREDENTIALS,
  });

  try {
    await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
    console.log(`ℹ️  Queue "${queueName}" already exists — skipping.`);
  } catch (err) {
    if (!(err instanceof QueueDoesNotExist)) throw err;

    await client.send(new CreateQueueCommand({ QueueName: queueName }));
    console.log(`✅ Queue "${queueName}" created at ${origin}`);
  }
}

async function main() {
  await setupDynamo();
  await setupSqs();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
