import { CanActivate, ExecutionContext, Injectable, RawBodyRequest } from '@nestjs/common';
import { verifyKey } from 'discord-interactions';
import { DiscordConfigService } from '../../common/config/discord-config-service';
import { Request } from 'express';

@Injectable()
export class DiscordSignatureGuard implements CanActivate {
  constructor(private readonly configService: DiscordConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const signature = req.headers['x-signature-ed25519'] as string | undefined;
    const timestamp = req.headers['x-signature-timestamp'] as string | undefined;
    const publicKey = this.configService.publicKey;

    if (!signature || !timestamp || !publicKey || !req.rawBody) {
      return false;
    }

    return verifyKey(req.rawBody, signature, timestamp, publicKey);
  }
}
