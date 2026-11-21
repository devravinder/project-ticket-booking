import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { GatewaySession } from "@tix/contracts";
import { Database, Switches } from "@tix/kit";
import { GatewayClient } from "../payments/gateway.client.js";
import { BookingsService, log } from "./bookings.service.js";

const TICK_MS = 1000;

type Claimed = { id: string; session_id: string | null; status: string };

// Claim due bookings and push next_check_at back (2, 4, 8 ... 30 s), so two instances never collide.
const CLAIM_SQL = (where: string) => `
  UPDATE bookings SET checks = checks + 1,
         next_check_at = now() + least(30, power(2, least(checks + 1, 5))) * interval '1 second'
  WHERE id IN (SELECT id FROM bookings WHERE ${where} AND next_check_at <= now()
               ORDER BY next_check_at LIMIT 20 FOR UPDATE SKIP LOCKED)
  RETURNING id, session_id, status`;

// The safety net under webhooks and returns: ask the gateway, and send refunds that are owed (ADR-011).
@Injectable()
export class Recovery implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(Recovery.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Switches) private readonly switches: Switches,
    @Inject(GatewayClient) private readonly gateway: GatewayClient,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.tick().finally(() => {
        this.running = null;
      });
    }, TICK_MS);
  }

  async tick(): Promise<void> {
    try {
      await this.reconcile();
      await this.refunds();
    } catch (error) {
      this.logger.warn(`recovery tick failed: ${(error as Error).message}`);
    }
  }

  // Bookings still waiting for news: webhooks get a head start of reconcileAfterMs.
  private async reconcile(): Promise<void> {
    const { rows } = await this.db.query<Claimed>(
      CLAIM_SQL(`settled_at IS NULL AND status IN ('PENDING_PAYMENT', 'EXPIRED')
                 AND created_at <= now() - $1 * interval '1 millisecond'`),
      [this.switches.get<number>("reconcileAfterMs")],
    );
    for (const b of rows) {
      try {
        const session = await this.sessionOf(b);
        await this.db.tx(async (c) => {
          if (!session) {
            await log(c, b.id, "reconcile: the gateway has no session for this booking");
            if (b.status === "EXPIRED")
              await c.query("UPDATE bookings SET settled_at = now() WHERE id = $1", [b.id]);
            return;
          }
          await log(c, b.id, "reconcile: asked the gateway", `session is ${session.status}`);
          await this.bookings.settle(c, b.id, session.id, session.status, "reconcile");
        });
      } catch (error) {
        this.logger.warn(`reconcile ${b.id.slice(0, 8)}: ${(error as Error).message}`);
      }
    }
  }

  // Money taken for seats someone else got: refund with a stable key, so a retry refunds once.
  private async refunds(): Promise<void> {
    const { rows } = await this.db.query<Claimed>(CLAIM_SQL("status = 'REFUND_PENDING'"));
    for (const b of rows) {
      if (!b.session_id) continue;
      try {
        const session = await this.gateway.refund(b.session_id, `refund-${b.id}`);
        await this.db.tx(async (c) => {
          await log(
            c,
            b.id,
            "refund job: refund sent to the gateway",
            `session is ${session.status}`,
          );
          await this.bookings.settle(c, b.id, session.id, session.status, "refund job");
        });
      } catch (error) {
        await this.db.tx((c) => log(c, b.id, "refund job: will retry", (error as Error).message));
      }
    }
  }

  // No stored session id: we may have crashed between creating it and saving it.
  private async sessionOf(b: Claimed): Promise<GatewaySession | null> {
    if (b.session_id) return this.gateway.getSession(b.session_id);
    const found = await this.gateway.findByRef(b.id);
    return found[0] ?? null;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
