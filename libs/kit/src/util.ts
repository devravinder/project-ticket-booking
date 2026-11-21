import { HttpException } from "@nestjs/common";
import { z } from "zod";

export { USER_HEADER } from "@tix/contracts";

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Exponential, capped; used for webhook and refund retries.
export const backoffMs = (attempt: number, baseMs = 500, maxMs = 10_000) =>
  Math.min(baseMs * 2 ** attempt, maxMs);

// Every error body has a stable code the UI and tests can branch on.
export function fail(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): never {
  throw new HttpException({ statusCode: status, code, message, ...extra }, status);
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) fail(400, "INVALID_REQUEST", z.prettifyError(result.error));
  return result.data;
}

export const userSchema = z
  .string({ error: "X-User header is required" })
  .regex(/^[a-z0-9_-]{3,30}$/, "X-User must be 3-30 of a-z, 0-9, _ or -");
