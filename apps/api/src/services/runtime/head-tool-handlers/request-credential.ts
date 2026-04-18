import { z } from 'zod';

import type { HeadTurn } from '@echidna-claw/contracts';
import { taskIdSchema } from '@echidna-claw/contracts';

export const requestCredentialArgsSchema = z
  .object({
    reason: z.string().trim().min(1).optional(),
    serviceAlias: z.string().trim().min(1),
    taskId: taskIdSchema.optional(),
  })
  .strict();

export async function handleRequestCredential(input: {
  args: unknown;
  channelId: string;
  headTurn: HeadTurn;
}): Promise<{
  deferredDirectives: [
    {
      kind: 'credential_request';
      request: {
        agentId: string;
        channelId: string;
        correlation: HeadTurn['correlation'];
        reason?: string;
        serviceAlias: string;
        taskId: string | null;
      };
    },
  ];
  effectSummaryPatch: {
    credentialRequested: true;
  };
  outputText: string;
}> {
  const args = requestCredentialArgsSchema.parse(input.args);

  return {
    deferredDirectives: [
      {
        kind: 'credential_request',
        request: {
          agentId: input.headTurn.agentId,
          channelId: input.channelId,
          correlation: input.headTurn.correlation,
          ...(args.reason ? { reason: args.reason } : {}),
          serviceAlias: args.serviceAlias,
          taskId: args.taskId ?? input.headTurn.taskId ?? null,
        },
      },
    ],
    effectSummaryPatch: {
      credentialRequested: true,
    },
    outputText:
      'Credential capture staged and the trusted Telegram channel will be prompted if this turn remains current.',
  };
}
