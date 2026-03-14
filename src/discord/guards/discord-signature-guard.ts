import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { verifyKey } from 'discord-interactions';

@Injectable()
export class DiscordSignatureGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const signature = req.headers['x-signature-ed25519'] as string | undefined;
    const timestamp = req.headers['x-signature-timestamp'] as
      | string
      | undefined;
    const publicKey = process.env.DISCORD_PUBLIC_KEY;

    if (!signature || !timestamp || !publicKey) {
      return false;
    }

    const body = JSON.stringify(req.body);
    return verifyKey(body, signature, timestamp, publicKey);
  }
}
