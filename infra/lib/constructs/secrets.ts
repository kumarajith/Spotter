import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface SecretsConstructProps {
  environment: string;
}

export class SecretsConstruct extends Construct {
  public readonly discordParam: ssm.IStringParameter;

  constructor(scope: Construct, id: string, props: SecretsConstructProps) {
    super(scope, id);

    // SSM SecureString — created manually before first deploy:
    // aws ssm put-parameter --name "/spotter/<env>/discord" --type SecureString \
    //   --value '{"botToken":"...","publicKey":"...","applicationId":"..."}'
    this.discordParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'DiscordParam',
      { parameterName: `/spotter/${props.environment}/discord` },
    );
  }
}
