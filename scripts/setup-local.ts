import 'dotenv/config';
import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';

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
    console.log(`Table "${tableName}" created at ${endpoint}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`Table "${tableName}" already exists — skipping.`);
      return;
    }
    throw err;
  }
}

async function main() {
  await setupDynamo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
