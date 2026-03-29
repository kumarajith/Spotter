import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { handler } from '../src/lambda';

const PORT = Number(process.env.PORT ?? 3000);

function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/interactions')) {
    res.writeHead(404).end('Not found');
    return;
  }

  const body = await collectBody(req);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k] = v;
  }

  const event = {
    body,
    headers,
    isBase64Encoded: false,
    requestContext: {} as any,
    rawPath: req.url,
    rawQueryString: '',
    routeKey: 'POST /interactions',
    version: '2.0',
  };

  try {
    const result = await handler(event as any);
    if (typeof result === 'string') {
      res.writeHead(200).end(result);
    } else {
      res.writeHead(result.statusCode ?? 200, result.headers as any);
      res.end(result.body);
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Internal error');
  }
});

server.listen(PORT, () => console.log(`Dev server listening on :${PORT}`));
