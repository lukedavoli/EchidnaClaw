import { z } from 'zod';

import type { HeadTurn } from '@echidna-claw/contracts';
import { approvalCategorySchema, isoDateTimeSchema, taskIdSchema } from '@echidna-claw/contracts';

import type { ApprovalLifecycleService } from '../approval-lifecycle-service.js';

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
  approvalLifecycleService: ApprovalLifecycleService;
  args: unknown;
  channelId: string;
  headTurn: HeadTurn;
}): Promise<{
  effectSummaryPatch: {
    approvalRequested: true;
  };
  outputText: string;
}> {
  const args = requestApprovalArgsSchema.parse(input.args);
  const approval = await input.approvalLifecycleService.requestApproval({
    ...(args.actionFingerprint ? { actionFingerprint: args.actionFingerprint } : {}),
    agentId: input.headTurn.agentId,
    blocking: args.blocking,
    category: args.category,
    channelId: input.channelId,
    correlation: input.headTurn.correlation,
    ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
    summary: args.summary,
    taskId: args.taskId,
  });

  return {
    effectSummaryPatch: {
      approvalRequested: true,
    },
    outputText: `Approval ${approval.id} requested for task ${approval.taskId}. The user will receive Telegram approve and reject controls.`,
  };
}
