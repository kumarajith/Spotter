# Spotter Infrastructure

AWS CDK app that provisions the Spotter stack (DynamoDB, Lambda, API Gateway, EventBridge Scheduler, CloudWatch).

## Commands

| Command                      | Description                               |
| ---------------------------- | ----------------------------------------- |
| `npm run build`              | Compile TypeScript                        |
| `npm test`                   | CDK template assertions                   |
| `npx cdk synth -c env=dev`   | Synthesize CloudFormation template        |
| `npx cdk diff -c env=dev`    | Compare deployed stack with current state |
| `npx cdk deploy -c env=dev`  | Deploy to dev                             |
| `npx cdk deploy -c env=prod` | Deploy to prod                            |

## Environments

Environment separation is handled via CDK context (`-c env=dev` / `-c env=prod`). Each environment gets its own stack (`Spotter-dev`, `Spotter-prod`).
