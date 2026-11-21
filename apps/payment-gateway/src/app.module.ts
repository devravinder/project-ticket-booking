import { Module } from "@nestjs/common";
import { KitModule, loadConfig } from "@tix/kit";
import { gatewayEnvSchema } from "./config.js";
import { PayPageController } from "./pay-page.controller.js";
import { SessionsController } from "./sessions.controller.js";
import { SessionsService } from "./sessions.service.js";
import { WebhookDeliverer } from "./webhooks.js";

// A fake payment provider: an external company in real life, so its own database.
@Module({
  imports: [
    KitModule.forService(loadConfig(gatewayEnvSchema), {
      switches: {
        // Time between pressing Pay and the bank's answer.
        slowPayMs: 0,
        // Delay before the first webhook attempt.
        webhookDelayMs: 0,
        // Webhooks are recorded but never sent (DROPPED): the merchant never hears.
        dropWebhooks: false,
        // Every webhook is sent twice.
        duplicateWebhooks: false,
        // Off: the customer is not sent back to the shop after paying.
        redirectBack: true,
      },
    }),
  ],
  controllers: [SessionsController, PayPageController],
  providers: [SessionsService, WebhookDeliverer],
})
export class AppModule {}
