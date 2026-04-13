import { z } from 'zod';

const dependencyHealthSchema = z
  .object({
    description: z.string().min(1),
    mode: z.enum(['stubbed', 'configured-placeholder']),
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
    runtimeMode: z.enum(['local-minimal', 'shared-cloud', 'cloud-deployed']),
    service: z.literal('api'),
    status: z.enum(['ready', 'not_ready']),
  })
  .strict();

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
