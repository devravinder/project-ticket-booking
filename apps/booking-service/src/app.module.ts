import { Module } from "@nestjs/common";
import { HOLD_MODES } from "@tix/contracts";
import { KitModule, loadConfig } from "@tix/kit";
import { BookingsController } from "./bookings/bookings.controller.js";
import { BookingsService } from "./bookings/bookings.service.js";
import { bookingEnvSchema } from "./config.js";
import { HoldExpiry } from "./holds/hold-expiry.js";
import { HoldsController } from "./holds/holds.controller.js";
import { HoldsService } from "./holds/holds.service.js";
import { LiveController } from "./live/live.controller.js";
import { SeatEvents } from "./live/seat-events.js";
import { GatewayClient } from "./payments/gateway.client.js";
import { ShowsController } from "./shows/shows.controller.js";
import { ShowsRepository } from "./shows/shows.repository.js";

// Owns shows, seats, holds and bookings.
@Module({
  imports: [
    KitModule.forService(loadConfig(bookingEnvSchema), {
      switches: {
        // 1 minute so the expiry is easy to watch; tests set a few seconds.
        holdTtlMs: 60_000,
        holdMode: "atomic",
        naiveDelayMs: 200,
        // The payment session ends this long before the hold, so most payments finish in time.
        paymentMarginMs: 10_000,
      },
      choices: { holdMode: HOLD_MODES },
    }),
  ],
  controllers: [ShowsController, HoldsController, LiveController, BookingsController],
  providers: [
    ShowsRepository,
    HoldsService,
    HoldExpiry,
    SeatEvents,
    GatewayClient,
    BookingsService,
  ],
})
export class AppModule {}
