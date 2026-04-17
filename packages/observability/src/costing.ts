import type { ModelPricing, RepositoryConfig, TokenUsage, UsagePricingStatus } from '@echidna-claw/contracts';

function hasUnpricedSupplementalTokens(tokens: TokenUsage): boolean {
  return (
    tokens.reasoningTokens != null ||
    tokens.toolInputTokens != null ||
    tokens.toolOutputTokens != null
  );
}

function resolveModelPricing(
  pricingEntries: readonly ModelPricing[],
  model: string,
  occurredAt: string,
): ModelPricing | null {
  const eligible = pricingEntries
    .filter((entry) => entry.model === model && entry.effectiveAt <= occurredAt)
    .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt));

  if (eligible.length > 0) {
    return eligible[0] ?? null;
  }

  return pricingEntries.find((entry) => entry.model === model) ?? null;
}

export function estimateUsageCost(input: {
  model: string;
  occurredAt: string;
  pricingEntries: RepositoryConfig['models']['pricing'];
  tokens: TokenUsage;
}): {
  estimatedCostUsd: number;
  pricingStatus: UsagePricingStatus;
} {
  const pricing = resolveModelPricing(input.pricingEntries, input.model, input.occurredAt);
  if (!pricing) {
    return {
      estimatedCostUsd: 0,
      pricingStatus: 'unpriced',
    };
  }

  const estimatedCostUsd =
    (input.tokens.inputTokens / 1_000_000) * pricing.inputUsd +
    (input.tokens.outputTokens / 1_000_000) * pricing.outputUsd;

  return {
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(9)),
    pricingStatus: hasUnpricedSupplementalTokens(input.tokens) ? 'partial' : 'estimated',
  };
}
