import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Database } from "@tix/kit";
import { HoldsService } from "./holds.service.js";

const SWEEP_MS = 1000;

// Tidies expired holds. Correctness does not depend on it: expired seats already read as free.
@Injectable()
export class HoldExpiry implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HoldExpiry.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(HoldsService) private readonly holds: HoldsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.sweep().finally(() => {
        this.running = null;
      });
    }, SWEEP_MS);
  }

  async sweep(): Promise<void> {
    try {
      const expired = await this.db.tx((c) => this.holds.expireDue(c));
      if (expired.length) {
        this.logger.log(`holds expired: ${expired.map((h) => h.id.slice(0, 8)).join(", ")}`);
      }
    } catch (error) {
      this.logger.warn(`expiry sweep failed: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
