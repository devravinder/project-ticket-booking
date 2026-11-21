import { Module } from "@nestjs/common";
import { CRASH_POINTS, HOLD_MODES } from "@tix/contracts";
import { KitModule, loadConfig } from "@tix/kit";
import { BookingsController } from "./bookings/bookings.controller.js";
import { BookingsService } from "./bookings/bookings.service.js";
import { ConsistencyController } from "./bookings/consistency.controller.js";
import { Recovery } from "./bookings/recovery.js";
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
        // Webhooks and returns get this head start before reconciliation asks the gateway.
        reconcileAfterMs: 15_000,
        // The webhook endpoint answers 503, as if this service were down.
        webhooksDown: false,
        // Exit the process at this point, like a crash (Lab; restart it yourself).
        crashPoint: "none",
      },
      choices: { holdMode: HOLD_MODES, crashPoint: CRASH_POINTS },
    }),
  ],
  controllers: [
    ShowsController,
    HoldsController,
    LiveController,
    BookingsController,
    ConsistencyController,
  ],
  providers: [
    ShowsRepository,
    HoldsService,
    HoldExpiry,
    SeatEvents,
    GatewayClient,
    BookingsService,
    Recovery,
  ],
})
export class AppModule {}
