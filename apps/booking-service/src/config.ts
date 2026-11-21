import { baseEnvSchema } from "@tix/kit";
import { z } from "zod";

export const bookingEnvSchema = baseEnvSchema.extend({
  GATEWAY_URL: z.url(),
  // The gateway calls this; one URL even with two instances, like a load balancer would give.
  WEBHOOK_URL: z.url(),
  WEBHOOK_SECRET: z.string().min(16),
  // Where the gateway sends the customer back after paying.
  WEB_URL: z.url(),
});

export type BookingConfig = z.infer<typeof bookingEnvSchema>;
