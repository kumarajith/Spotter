import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  PutCommandInput,
  GetCommand,
  GetCommandInput,
  QueryCommand,
  QueryCommandInput,
  ScanCommand,
  ScanCommandInput,
  DeleteCommand,
  DeleteCommandInput,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';

export class DynamoService {
  private readonly client: DynamoDBDocumentClient;
  readonly tableName: string;

  constructor() {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) {
      throw new Error('TABLE_NAME environment variable is required');
    }
    this.tableName = tableName;

    const clientConfig = process.env.DYNAMODB_ENDPOINT
      ? { endpoint: process.env.DYNAMODB_ENDPOINT, region: 'us-east-1' }
      : {};
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));
  }

  put(item: Record<string, unknown>, extra?: Omit<PutCommandInput, 'TableName' | 'Item'>) {
    return this.client.send(new PutCommand({ ...extra, TableName: this.tableName, Item: item }));
  }

  get(key: Record<string, unknown>, extra?: Omit<GetCommandInput, 'TableName' | 'Key'>) {
    return this.client.send(new GetCommand({ ...extra, TableName: this.tableName, Key: key }));
  }

  query(params: Omit<QueryCommandInput, 'TableName'>) {
    return this.client.send(new QueryCommand({ ...params, TableName: this.tableName }));
  }

  scan(params: Omit<ScanCommandInput, 'TableName'>) {
    return this.client.send(new ScanCommand({ ...params, TableName: this.tableName }));
  }

  delete(key: Record<string, unknown>, extra?: Omit<DeleteCommandInput, 'TableName' | 'Key'>) {
    return this.client.send(new DeleteCommand({ ...extra, TableName: this.tableName, Key: key }));
  }

  transactWrite(params: TransactWriteCommandInput) {
    return this.client.send(new TransactWriteCommand(params));
  }
}
