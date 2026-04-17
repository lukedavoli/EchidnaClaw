import { z } from 'zod';

import { isoDateTimeSchema, modelIdSchema, nonEmptyStringSchema, nonNegativeNumberSchema } from './identifiers.js';
import { analyticsWindowSchema } from './services.js';
import {
  approvalCategorySchema,
  headTriggerKindSchema,
  sandboxCredentialExposureSchema,
} from './records.js';

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

export const approvalPolicyCategorySchema = z
  .object({
    id: approvalCategorySchema,
    displayName: nonEmptyStringSchema,
    stepUpRequired: z.boolean().default(false),
    defaultExpiryMinutes: z.number().int().positive(),
  })
  .strict();

export const approvalPolicySchema = z
  .object({
    categories: z.array(approvalPolicyCategorySchema).min(1),
  })
  .strict();

export const credentialServiceBindingRuleSchema = z
  .object({
    exposure: sandboxCredentialExposureSchema,
    targetName: nonEmptyStringSchema,
  })
  .strict();

export const credentialServiceConfigSchema = z
  .object({
    provider: nonEmptyStringSchema,
    alias: nonEmptyStringSchema,
    displayName: nonEmptyStringSchema,
    reasonTemplate: nonEmptyStringSchema,
    storageNotice: nonEmptyStringSchema,
    accessPolicyRef: nonEmptyStringSchema,
    sandboxBindings: z.array(credentialServiceBindingRuleSchema).default([]),
  })
  .strict();

export const memoryRememberCategorySchema = z.enum([
  'preferences',
  'standing_instructions',
  'durable_facts',
  'recurring_patterns',
  'agent_guidance',
]);

export const memoryExcludeCategorySchema = z.enum([
  'operational_scratch',
  'active_task_state',
  'queue_state',
  'approvals',
  'credentials',
  'run_journal_detail',
]);

export const memoryConfigSchema = z
  .object({
    storeNamePrefix: nonEmptyStringSchema,
    retrieval: z
      .object({
        maxItems: z.number().int().positive(),
        maxCharsPerItem: z.number().int().positive(),
      })
      .strict(),
    writes: z
      .object({
        allowTriggerKinds: z.array(headTriggerKindSchema).min(1),
      })
      .strict(),
    policy: z
      .object({
        remember: z.array(memoryRememberCategorySchema).min(1),
        exclude: z.array(memoryExcludeCategorySchema).min(1),
      })
      .strict(),
  })
  .strict();

export const observabilityConfigSchema = z
  .object({
    auditRetentionDays: z.number().int().positive(),
    analyticsDefaultWindow: analyticsWindowSchema,
    analyticsMaxChartPoints: z.number().int().positive(),
    compatibilityRawEventsEnabled: z.boolean().default(true),
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
    approvals: z
      .object({
        policy: approvalPolicySchema,
      })
      .strict(),
    credentials: z
      .object({
        services: z.array(credentialServiceConfigSchema).min(1),
      })
      .strict(),
    memory: memoryConfigSchema,
    observability: observabilityConfigSchema,
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

    const approvalCategories = new Set<string>();
    for (const category of value.approvals.policy.categories) {
      if (approvalCategories.has(category.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['approvals', 'policy', 'categories'],
          message: `Duplicate approval category '${category.id}'`,
        });
      }
      approvalCategories.add(category.id);
    }

    const credentialAliases = new Set<string>();
    for (const service of value.credentials.services) {
      if (credentialAliases.has(service.alias)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['credentials', 'services'],
          message: `Duplicate credential service alias '${service.alias}'`,
        });
      }
      credentialAliases.add(service.alias);
    }

    const memoryRemember = new Set<string>();
    for (const category of value.memory.policy.remember) {
      if (memoryRemember.has(category)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['memory', 'policy', 'remember'],
          message: `Duplicate memory remember category '${category}'`,
        });
      }
      memoryRemember.add(category);
    }

    const memoryExclude = new Set<string>();
    for (const category of value.memory.policy.exclude) {
      if (memoryExclude.has(category)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['memory', 'policy', 'exclude'],
          message: `Duplicate memory exclude category '${category}'`,
        });
      }
      memoryExclude.add(category);
    }
  });

export type ModelPricing = z.infer<typeof modelPricingSchema>;
export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export type SandboxPackageManager = z.infer<typeof sandboxPackageManagerSchema>;
export type PackageAllowlist = z.infer<typeof packageAllowlistSchema>;
export type CapabilityRegistryEntry = z.infer<typeof capabilityRegistryEntrySchema>;
export type AgentFactoryProfile = z.infer<typeof agentFactoryProfileSchema>;
export type ApprovalPolicyCategory = z.infer<typeof approvalPolicyCategorySchema>;
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
export type CredentialServiceBindingRule = z.infer<typeof credentialServiceBindingRuleSchema>;
export type CredentialServiceConfig = z.infer<typeof credentialServiceConfigSchema>;
export type MemoryRememberCategory = z.infer<typeof memoryRememberCategorySchema>;
export type MemoryExcludeCategory = z.infer<typeof memoryExcludeCategorySchema>;
export type MemoryConfig = z.infer<typeof memoryConfigSchema>;
export type ObservabilityConfig = z.infer<typeof observabilityConfigSchema>;
export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;
