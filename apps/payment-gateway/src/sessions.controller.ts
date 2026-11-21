import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { IDEMPOTENCY_HEADER } from "@tix/contracts";
import { parse } from "@tix/kit";
import type { Response } from "express";
import { z } from "zod";
import { SessionsService } from "./sessions.service.js";
import { WebhookDeliverer } from "./webhooks.js";

const keySchema = z
  .string({ error: "Idempotency-Key header is required" })
  .min(8, "Idempotency-Key must be 8-100 characters")
  .max(100, "Idempotency-Key must be 8-100 characters");

const sessionIdSchema = z.string().regex(/^ps_[A-Za-z0-9_-]{16}$/, "invalid session id");

const createSchema = z.object({
  merchantRef: z.string().min(1).max(100),
  amountCents: z.number().int().positive(),
  returnUrl: z.url(),
  webhookUrl: z.url(),
  expiresAt: z.iso
    .datetime({ offset: true })
    .refine((v) => new Date(v).getTime() > Date.now(), "expiresAt must be in the future"),
});

const paySchema = z.object({ outcome: z.enum(["approve", "decline"]) });

// The merchant-facing API (JSON).
@Controller()
export class SessionsController {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(WebhookDeliverer) private readonly webhooks: WebhookDeliverer,
  ) {}

  @Post("sessions")
  async create(
    @Headers(IDEMPOTENCY_HEADER) key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, replayed } = await this.sessions.create(
      parse(keySchema, key),
      parse(createSchema, body),
    );
    if (replayed) res.status(200).setHeader("idempotent-replayed", "true");
    return session;
  }

  // The status API: what a merchant asks when it never heard back (reconciliation).
  @Get("sessions/:id")
  get(@Param("id") id: string) {
    return this.sessions.get(parse(sessionIdSchema, id));
  }

  // Same as pressing a button on the pay page; used by tests and the Lab.
  @Post("sessions/:id/pay")
  @HttpCode(200)
  pay(@Param("id") id: string, @Body() body: unknown) {
    return this.sessions.pay(parse(sessionIdSchema, id), parse(paySchema, body).outcome);
  }

  @Post("sessions/:id/refund")
  @HttpCode(200)
  refund(@Param("id") id: string, @Headers(IDEMPOTENCY_HEADER) key: unknown) {
    return this.sessions.refund(parse(sessionIdSchema, id), parse(keySchema, key));
  }

  @Get("admin/sessions")
  list(@Query("merchantRef") merchantRef?: string) {
    return this.sessions.list(merchantRef);
  }

  @Get("admin/sessions/:id")
  detail(@Param("id") id: string) {
    return this.sessions.detail(parse(sessionIdSchema, id));
  }

  // Lab: a dropped webhook can be sent after all, like "resend" in a gateway dashboard.
  @Post("admin/webhooks/:id/redeliver")
  @HttpCode(200)
  async redeliver(@Param("id") id: string) {
    await this.webhooks.redeliver(parse(z.string().min(1).max(40), id));
    return { redelivering: id };
  }
}
