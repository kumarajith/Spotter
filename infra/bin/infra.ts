#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SpotterStack } from '../lib/spotter-stack';

const app = new cdk.App();
const env = String(app.node.tryGetContext('env') ?? '');
if (!['dev', 'prod'].includes(env)) {
  throw new Error(`Missing or invalid env context: "${env}". Pass -c env=dev or -c env=prod`);
}

new SpotterStack(app, `Spotter-${env}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-south-1', // Mumbai — closest to you
  },
  environment: env,
});
