import { z } from 'zod';

import type { HeadTurn } from '@echidna-claw/contracts';
import { taskIdSchema } from '@echidna-claw/contracts';

import type { CredentialLifecycleService } from '../credential-lifecycle-service.js';

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
  credentialLifecycleService: CredentialLifecycleService;
  headTurn: HeadTurn;
}): Promise<{
  effectSummaryPatch: {
    credentialRequested: true;
  };
  outputText: string;
}> {
  const args = requestCredentialArgsSchema.parse(input.args);
  const capture = await input.credentialLifecycleService.requestCapture({
    agentId: input.headTurn.agentId,
    channelId: input.channelId,
    correlation: input.headTurn.correlation,
    ...(args.reason ? { reason: args.reason } : {}),
    serviceAlias: args.serviceAlias,
    taskId: args.taskId ?? input.headTurn.taskId ?? null,
  });

  return {
    effectSummaryPatch: {
      credentialRequested: true,
    },
    outputText: `Credential capture ${capture.id} requested for ${capture.displayName}. The user will be prompted in Telegram and blocked work will resume after the credential is received.`,
  };
}
