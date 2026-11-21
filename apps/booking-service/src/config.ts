import { baseEnvSchema } from "@tix/kit";
import type { z } from "zod";

export const bookingEnvSchema = baseEnvSchema;

export type BookingConfig = z.infer<typeof bookingEnvSchema>;
