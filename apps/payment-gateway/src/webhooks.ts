import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  backoffMs,
  Database,
  fail,
  SERVICE_CONFIG,
  SIGNATURE_HEADER,
  signWebhook,
  Switches,
} from "@tix/kit";
import type { GatewayConfig } from "./config.js";

const TICK_MS = 250;
const SEND_TIMEOUT_MS = 5000;
// Real gateways retry for days; a few minutes is enough to watch it here.
const MAX_ATTEMPTS = 25;
// A claimed event is retried by anyone after this, if its sender died mid-send.
const LEASE_S = 30;

type Due = { id: string; url: string; payload: object; attempts: number };

// Delivers the webhook outbox: at least once, retried with backoff until a 2xx (ADR-009).
@Injectable()
export class WebhookDeliverer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliverer.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    @Inject(SERVICE_CONFIG) private readonly config: GatewayConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(Switches) private readonly switches: Switches,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.tick().finally(() => {
        this.running = null;
      });
    }, TICK_MS);
  }

  async redeliver(id: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE webhook_events SET status = 'PENDING', next_attempt_at = now(), last_error = NULL
       WHERE id = $1`,
      [id],
    );
    if (!r.rowCount) fail(404, "WEBHOOK_NOT_FOUND", `webhook event ${id} does not exist`);
  }

  private async tick(): Promise<void> {
    try {
      // Claim and commit first: no HTTP call inside a transaction.
      const { rows } = await this.db.query<Due>(
        `UPDATE webhook_events SET attempts = attempts + 1,
                next_attempt_at = now() + $1 * interval '1 second'
         WHERE id IN (SELECT id FROM webhook_events WHERE status = 'PENDING' AND next_attempt_at <= now()
                      ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED)
         RETURNING id, url, payload, attempts`,
        [LEASE_S],
      );
      await Promise.all(rows.map((e) => this.deliver(e)));
    } catch (error) {
      this.logger.warn(`webhook tick failed: ${(error as Error).message}`);
    }
  }

  private async deliver(event: Due): Promise<void> {
    const body = JSON.stringify(event.payload);
    let error = await this.send(event, body);
    // At-least-once means duplicates happen; the Lab makes every one arrive twice.
    if (!error && this.switches.get<boolean>("duplicateWebhooks"))
      error = await this.send(event, body);
    if (!error) {
      await this.db.query(
        `UPDATE webhook_events SET status = 'DELIVERED', delivered_at = now(), last_error = NULL
         WHERE id = $1`,
        [event.id],
      );
      return;
    }
    const gaveUp = event.attempts >= MAX_ATTEMPTS;
    await this.db.query(
      `UPDATE webhook_events SET last_error = $2, status = $3,
              next_attempt_at = now() + $4 * interval '1 millisecond'
       WHERE id = $1`,
      [event.id, error, gaveUp ? "GAVE_UP" : "PENDING", backoffMs(event.attempts - 1, 500, 10_000)],
    );
    this.logger.warn(`webhook ${event.id} attempt ${event.attempts} failed: ${error}`);
  }

  private async send(event: Due, body: string): Promise<string | null> {
    try {
      const res = await fetch(event.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: signWebhook(this.config.WEBHOOK_SECRET, body),
          "gateway-event-id": event.id,
        },
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      return res.ok ? null : `HTTP ${res.status}`;
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      return err.cause?.code ?? err.message;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
