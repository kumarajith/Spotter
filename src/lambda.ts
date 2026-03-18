import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configure as serverlessExpress } from '@codegenie/serverless-express';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import express from 'express';

type ServerlessHandler = (event: unknown, context: unknown) => Promise<unknown>;

let server: ServerlessHandler;

async function bootstrap(): Promise<ServerlessHandler> {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    logger: ['error', 'warn'],
    rawBody: true,
  });
  await app.init();
  return serverlessExpress({ app: expressApp });
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<unknown> => {
  server = server ?? (await bootstrap());
  return server(event, context);
};
