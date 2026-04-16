import { createHash } from 'node:crypto';

import type { Approval, ApprovalCategory, RepositoryConfig } from '@echidna-claw/contracts';

export type ApprovalPolicyCategory = RepositoryConfig['approvals']['policy']['categories'][number];

export function resolveApprovalPolicy(
  repositoryConfig: RepositoryConfig,
  category: ApprovalCategory,
): ApprovalPolicyCategory {
  const policy = repositoryConfig.approvals.policy.categories.find((entry) => entry.id === category);
  if (!policy) {
    throw new Error(`Approval category '${category}' is not configured.`);
  }

  return policy;
}

export function createApprovalActionFingerprint(input: {
  category: ApprovalCategory;
  summary: string;
  taskEnvelopeId?: string | null;
  taskId: string;
}): string {
  const source = JSON.stringify({
    category: input.category,
    summary: input.summary.trim(),
    taskEnvelopeId: input.taskEnvelopeId ?? null,
    taskId: input.taskId,
  });

  return createHash('sha256').update(source).digest('hex');
}

export function isApprovalExpired(approval: Approval, asOf: string): boolean {
  return approval.expiresAt != null && approval.expiresAt <= asOf;
}
