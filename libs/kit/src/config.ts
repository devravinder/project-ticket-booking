import { z } from "zod";

export const baseEnvSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  SERVICE_NAME: z.string().min(1),
  DATABASE_URL: z.url(),
  // Only the booking service uses Redis (waiting room); /health checks it when set.
  REDIS_URL: z.url().optional(),
});

export type BaseConfig = z.infer<typeof baseEnvSchema>;

export const SERVICE_CONFIG = Symbol("SERVICE_CONFIG");

export function loadConfig<T extends z.ZodType<BaseConfig>>(
  schema: T,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
