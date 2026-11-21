import { baseEnvSchema } from "@tix/kit";
import { z } from "zod";

export const gatewayEnvSchema = baseEnvSchema.extend({
  // Where the browser reaches the hosted pay page.
  PUBLIC_URL: z.url(),
  // Shared with the booking service to sign webhooks; a vault value in production.
  WEBHOOK_SECRET: z.string().min(16),
});

export type GatewayConfig = z.infer<typeof gatewayEnvSchema>;
