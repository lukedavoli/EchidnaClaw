import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length > 0 ? JSON.parse(raw) : null;
}

export async function startTelegramStub(options: {
  answerCallbackResponse?: {
    body: unknown;
    statusCode: number;
  };
  getMeResponse?: {
    body: unknown;
    statusCode: number;
  };
  sendMessageResponse?: {
    body: unknown;
    statusCode: number;
  };
  setWebhookResponse?: {
    body: unknown;
    statusCode: number;
  };
} = {}): Promise<{
  baseUrl: string;
  close(): Promise<void>;
  requests: Array<{
    body: unknown;
    method: string | undefined;
    url: string | undefined;
  }>;
}> {
  const requests: Array<{
    body: unknown;
    method: string | undefined;
    url: string | undefined;
  }> = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readJson(request);
    requests.push({
      body,
      method: request.method,
      url: request.url,
    });

    const sendMessageResponse = options.sendMessageResponse ?? {
      body: {
        ok: true,
        result: {
          message_id: 999,
        },
      },
      statusCode: 200,
    };
    const answerCallbackResponse = options.answerCallbackResponse ?? {
      body: {
        ok: true,
        result: true,
      },
      statusCode: 200,
    };
    const getMeResponse = options.getMeResponse ?? {
      body: {
        ok: true,
        result: {
          first_name: 'Ops Bot',
          id: 321,
          username: 'ops-triage-bot',
        },
      },
      statusCode: 200,
    };
    const setWebhookResponse = options.setWebhookResponse ?? {
      body: {
        ok: true,
        result: true,
      },
      statusCode: 200,
    };

    if (request.url?.endsWith('/sendMessage')) {
      response.writeHead(sendMessageResponse.statusCode, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(sendMessageResponse.body));
      return;
    }

    if (request.url?.endsWith('/answerCallbackQuery')) {
      response.writeHead(answerCallbackResponse.statusCode, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(answerCallbackResponse.body));
      return;
    }

    if (request.url?.endsWith('/getMe')) {
      response.writeHead(getMeResponse.statusCode, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(getMeResponse.body));
      return;
    }

    if (request.url?.endsWith('/setWebhook')) {
      response.writeHead(setWebhookResponse.statusCode, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(setWebhookResponse.body));
      return;
    }

    response.writeHead(404, {
      'content-type': 'application/json',
    });
    response.end(JSON.stringify({ ok: false, description: 'Not found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    requests,
  };
}
