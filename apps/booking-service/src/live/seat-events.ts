import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { backoffMs, Database, type Tx } from "@tix/kit";
import pg from "pg";

export const SEAT_CHANNEL = "seat_changes";

export type SeatChange = { showId: string; seats: string[] };
type Listener = (change: SeatChange | "resync") => void;

// Fans seat changes out to every instance: NOTIFY in the writing transaction, LISTEN here (ADR-008).
@Injectable()
export class SeatEvents implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SeatEvents.name);
  private readonly listeners = new Set<Listener>();
  private client: pg.Client | null = null;
  private stopped = false;
  private attempt = 0;
  readonly stats = { listening: false, received: 0, reconnects: 0 };

  constructor(@Inject(Database) private readonly db: Database) {}

  // Delivered only if the transaction commits, so a rolled-back hold is never announced.
  async publish(c: Tx, changes: { showId: string; seatNo: string }[]): Promise<void> {
    const byShow = new Map<string, string[]>();
    for (const { showId, seatNo } of changes) {
      byShow.set(showId, [...(byShow.get(showId) ?? []), seatNo]);
    }
    for (const [showId, seats] of byShow) {
      await c.query("SELECT pg_notify($1, $2)", [SEAT_CHANNEL, JSON.stringify({ showId, seats })]);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get subscribers(): number {
    return this.listeners.size;
  }

  // Lab: lose the LISTEN connection on purpose and watch the reconnect and resync.
  dropConnection(): boolean {
    if (!this.client) return false;
    this.client.end().catch(() => undefined);
    return true;
  }

  onApplicationBootstrap(): void {
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.db.config.DATABASE_URL });
    client.on("notification", (msg) => {
      this.stats.received++;
      if (!msg.payload) return;
      const change = JSON.parse(msg.payload) as SeatChange;
      for (const listener of this.listeners) listener(change);
    });
    // error and end can both fire for one failure; reconnect only once.
    let gone = false;
    const onLost = (error: Error) => {
      if (gone) return;
      gone = true;
      this.lost(client, error);
    };
    client.on("error", onLost);
    client.on("end", () => onLost(new Error("connection ended")));
    try {
      await client.connect();
      await client.query(`LISTEN ${SEAT_CHANNEL}`);
      this.client = client;
      this.stats.listening = true;
      if (this.attempt > 0) {
        this.logger.log("listening again; resyncing open seat maps");
        // Changes made while we were deaf were never delivered: everyone gets a fresh snapshot.
        for (const listener of this.listeners) listener("resync");
      }
      this.attempt = 0;
    } catch (error) {
      onLost(error as Error);
    }
  }

  private lost(client: pg.Client, error: Error): void {
    if (this.stopped) return;
    this.client = null;
    this.stats.listening = false;
    this.stats.reconnects++;
    client.end().catch(() => undefined);
    const delay = backoffMs(this.attempt++, 500, 5000);
    this.logger.warn(`LISTEN connection lost (${error.message}); retrying in ${delay} ms`);
    setTimeout(() => void this.connect(), delay);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.client?.end().catch(() => undefined);
  }
}
