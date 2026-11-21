import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  type RawBodyRequest,
  Req,
} from "@nestjs/common";
import type { WebhookEvent } from "@tix/contracts";
import {
  fail,
  parse,
  SERVICE_CONFIG,
  SIGNATURE_HEADER,
  USER_HEADER,
  userSchema,
  verifyWebhook,
} from "@tix/kit";
import type { Request } from "express";
import { z } from "zod";
import type { BookingConfig } from "../config.js";
import { BookingsService } from "./bookings.service.js";

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["payment.succeeded", "payment.failed", "refund.succeeded"]),
  createdAt: z.string(),
  data: z.object({
    sessionId: z.string().min(1),
    merchantRef: z.string().min(1),
    amountCents: z.number().int(),
    status: z.enum(["OPEN", "PROCESSING", "PAID", "DECLINED", "EXPIRED", "REFUNDED"]),
  }),
});

@Controller()
export class BookingsController {
  constructor(
    @Inject(SERVICE_CONFIG) private readonly config: BookingConfig,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  @Post("holds/:id/checkout")
  @HttpCode(200)
  checkout(@Param("id") id: string, @Headers(USER_HEADER) user: unknown) {
    return this.bookings.checkout(parse(z.uuid(), id), parse(userSchema, user));
  }

  @Get("bookings")
  mine(@Headers(USER_HEADER) user: unknown) {
    return this.bookings.mine(parse(userSchema, user));
  }

  @Get("bookings/:id")
  get(@Param("id") id: string) {
    return this.bookings.get(parse(z.uuid(), id));
  }

  // Called by the web app when the gateway sends the customer back.
  @Post("bookings/:id/verify")
  @HttpCode(200)
  verify(@Param("id") id: string) {
    return this.bookings.verify(parse(z.uuid(), id));
  }

  // Anyone can POST here: only a valid signature over the raw body makes it the gateway.
  @Post("webhooks/gateway")
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>, @Headers(SIGNATURE_HEADER) signature?: string) {
    const raw = req.rawBody?.toString("utf8") ?? "";
    const check = verifyWebhook(this.config.WEBHOOK_SECRET, raw, signature);
    if (!check.ok) fail(401, "INVALID_SIGNATURE", check.reason);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      fail(400, "INVALID_REQUEST", "body is not JSON");
    }
    return this.bookings.onWebhook(parse(eventSchema, body) as WebhookEvent);
  }
}
