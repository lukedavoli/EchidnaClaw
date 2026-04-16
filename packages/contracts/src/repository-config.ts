import { z } from 'zod';

import { isoDateTimeSchema, modelIdSchema, nonEmptyStringSchema, nonNegativeNumberSchema } from './identifiers.js';

export const modelPricingSchema = z
  .object({
    model: modelIdSchema,
    provider: z.enum(['azure-foundry']),
    effectiveAt: isoDateTimeSchema,
    unit: z.literal('1m_tokens'),
    inputUsd: nonNegativeNumberSchema,
    outputUsd: nonNegativeNumberSchema,
  })
  .strict();

export const sandboxPolicySchema = z
  .object({
    name: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    allowFilesystemWriteUnder: z.array(nonEmptyStringSchema).min(1),
    blockFilesystemPaths: z.array(nonEmptyStringSchema).default([]),
    allowOutboundHosts: z.array(nonEmptyStringSchema).default([]),
    blockOutboundHosts: z.array(nonEmptyStringSchema).default([]),
    allowCommands: z.array(nonEmptyStringSchema).min(1),
    resourceLimits: z
      .object({
        defaultTimeoutMs: z.number().int().positive(),
        maxTimeoutMs: z.number().int().positive(),
        maxOutputBytes: z.number().int().positive(),
        maxMemoryMb: z.number().int().positive(),
        maxCpuSeconds: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const sandboxPackageManagerSchema = z.enum(['npm', 'pnpm', 'pip']);

export const packageAllowlistSchema = z
  .object({
    name: nonEmptyStringSchema,
    packageManager: sandboxPackageManagerSchema,
    packages: z.array(nonEmptyStringSchema).min(1),
  })
  .strict();

export const capabilityRegistryEntrySchema = z
  .object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    category: z.enum(['channel', 'tool', 'integration', 'ui']),
  })
  .strict();

export const agentFactoryProfileSchema = z
  .object({
    version: nonEmptyStringSchema,
    defaultTimeZone: nonEmptyStringSchema,
    initialResponsibilitiesSummary: z.string().trim().default(''),
  })
  .strict();

export const repositoryConfigSchema = z
  .object({
    version: z.literal('1'),
    models: z
      .object({
        defaultModel: modelIdSchema,
        pricing: z.array(modelPricingSchema).min(1),
      })
      .strict(),
    agents: z
      .object({
        factoryProfile: agentFactoryProfileSchema,
      })
      .strict(),
    sandbox: z
      .object({
        defaultPolicy: nonEmptyStringSchema,
        defaultPackageAllowlist: nonEmptyStringSchema,
        policies: z.array(sandboxPolicySchema).min(1),
        packageAllowlists: z.array(packageAllowlistSchema).min(1),
      })
      .strict(),
    capabilities: z
      .object({
        registry: z.array(capabilityRegistryEntrySchema).min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const policyNames = new Set<string>();
    for (const policy of value.sandbox.policies) {
      if (policyNames.has(policy.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sandbox', 'policies'],
          message: `Duplicate sandbox policy '${policy.name}'`,
        });
      }
      policyNames.add(policy.name);
    }

    if (!policyNames.has(value.sandbox.defaultPolicy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sandbox', 'defaultPolicy'],
        message: 'Default sandbox policy must exist in sandbox.policies',
      });
    }

    const pricedModels = new Set(value.models.pricing.map((entry) => entry.model));
    if (!pricedModels.has(value.models.defaultModel)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['models', 'defaultModel'],
        message: 'Default model must have a pricing entry',
      });
    }

    const allowlistNames = new Set<string>();
    for (const allowlist of value.sandbox.packageAllowlists) {
      if (allowlistNames.has(allowlist.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sandbox', 'packageAllowlists'],
          message: `Duplicate package allowlist '${allowlist.name}'`,
        });
      }
      allowlistNames.add(allowlist.name);
    }

    if (!allowlistNames.has(value.sandbox.defaultPackageAllowlist)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sandbox', 'defaultPackageAllowlist'],
        message: 'Default package allowlist must exist in sandbox.packageAllowlists',
      });
    }

    const capabilityIds = new Set<string>();
    for (const capability of value.capabilities.registry) {
      if (capabilityIds.has(capability.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilities', 'registry'],
          message: `Duplicate capability '${capability.id}'`,
        });
      }
      capabilityIds.add(capability.id);
    }
  });

export type ModelPricing = z.infer<typeof modelPricingSchema>;
export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export type SandboxPackageManager = z.infer<typeof sandboxPackageManagerSchema>;
export type PackageAllowlist = z.infer<typeof packageAllowlistSchema>;
export type CapabilityRegistryEntry = z.infer<typeof capabilityRegistryEntrySchema>;
export type AgentFactoryProfile = z.infer<typeof agentFactoryProfileSchema>;
export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;
