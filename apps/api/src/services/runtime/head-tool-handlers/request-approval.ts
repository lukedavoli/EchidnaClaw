import { z } from 'zod';

import type { HeadTurn } from '@echidna-claw/contracts';
import { approvalCategorySchema, isoDateTimeSchema, taskIdSchema } from '@echidna-claw/contracts';

export const requestApprovalArgsSchema = z
  .object({
    actionFingerprint: z.string().trim().min(1).optional(),
    blocking: z.boolean().default(true),
    category: approvalCategorySchema,
    expiresAt: isoDateTimeSchema.optional(),
    summary: z.string().trim().min(1),
    taskId: taskIdSchema,
  })
  .strict();

export async function handleRequestApproval(input: {
  args: unknown;
  channelId: string;
  headTurn: HeadTurn;
}): Promise<{
  deferredDirectives: [
    {
      kind: 'approval_request';
      request: {
        actionFingerprint?: string;
        agentId: string;
        blocking: boolean;
        category: z.infer<typeof approvalCategorySchema>;
        channelId: string;
        correlation: HeadTurn['correlation'];
        expiresAt: string | null;
        summary: string;
        taskId: z.infer<typeof taskIdSchema>;
      };
    },
  ];
  effectSummaryPatch: {
    approvalRequested: true;
  };
  outputText: string;
}> {
  const args = requestApprovalArgsSchema.parse(input.args);

  return {
    deferredDirectives: [
      {
        kind: 'approval_request',
        request: {
          ...(args.actionFingerprint ? { actionFingerprint: args.actionFingerprint } : {}),
          agentId: input.headTurn.agentId,
          blocking: args.blocking,
          category: args.category,
          channelId: input.channelId,
          correlation: input.headTurn.correlation,
          expiresAt: args.expiresAt ?? null,
          summary: args.summary,
          taskId: args.taskId,
        },
      },
    ],
    effectSummaryPatch: {
      approvalRequested: true,
    },
    outputText:
      'Approval request staged and Telegram approve or reject controls will be sent if this turn remains current.',
  };
}
