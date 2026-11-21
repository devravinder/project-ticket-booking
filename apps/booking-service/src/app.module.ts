import { Module } from "@nestjs/common";
import { KitModule, loadConfig } from "@tix/kit";
import { bookingEnvSchema } from "./config.js";
import { ShowsController } from "./shows/shows.controller.js";
import { ShowsRepository } from "./shows/shows.repository.js";

// Owns shows, seats, holds and bookings.
@Module({
  imports: [KitModule.forService(loadConfig(bookingEnvSchema))],
  controllers: [ShowsController],
  providers: [ShowsRepository],
})
export class AppModule {}
