import { z } from 'zod';

const dependencyHealthModeSchema = z.enum(['stubbed', 'configured-placeholder']);
const runtimeModeSchema = z.enum(['local-minimal', 'shared-cloud', 'cloud-deployed']);

export const dependencyHealthSchema = z
  .object({
    description: z.string().min(1),
    mode: dependencyHealthModeSchema,
    ready: z.boolean(),
  })
  .strict();

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        retryable: z.boolean(),
        traceId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const readinessResponseSchema = z
  .object({
    dependencies: z.record(z.string(), dependencyHealthSchema),
    runtimeMode: runtimeModeSchema,
    service: z.literal('api'),
    status: z.enum(['ready', 'not_ready']),
  })
  .strict();

export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;
export type DependencyHealthMode = z.infer<typeof dependencyHealthModeSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
