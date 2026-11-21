import { Module } from "@nestjs/common";
import { KitModule, loadConfig } from "@tix/kit";
import { bookingEnvSchema } from "./config.js";

// Owns shows, seats, holds and bookings.
@Module({
  imports: [KitModule.forService(loadConfig(bookingEnvSchema))],
})
export class AppModule {}
