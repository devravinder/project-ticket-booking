import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  type MessageEvent,
  type OnModuleDestroy,
  Param,
  Post,
  Sse,
} from "@nestjs/common";
import type { Seat } from "@tix/contracts";
import { type BaseConfig, parse, SERVICE_CONFIG } from "@tix/kit";
import { Observable, type Subscriber } from "rxjs";
import { showIdSchema } from "../shows/shows.controller.js";
import { ShowsRepository } from "../shows/shows.repository.js";
import { SeatEvents } from "./seat-events.js";

// Keeps proxies and browsers from closing an idle stream.
const PING_MS = 15_000;

type Viewer = Subscriber<MessageEvent>;

// One SSE stream per open seat map: a snapshot first, then only the seats that changed.
@Controller()
export class LiveController implements OnModuleDestroy {
  private readonly logger = new Logger(LiveController.name);
  private readonly viewers = new Map<string, Set<Viewer>>();
  private readonly unsubscribe: () => void;

  constructor(
    @Inject(SERVICE_CONFIG) private readonly config: BaseConfig,
    @Inject(ShowsRepository) private readonly shows: ShowsRepository,
    @Inject(SeatEvents) private readonly events: SeatEvents,
  ) {
    this.unsubscribe = this.events.subscribe((change) => {
      if (change === "resync") {
        for (const [showId, viewers] of this.viewers) void this.snapshot(showId, [...viewers]);
      } else if (this.viewers.has(change.showId)) {
        void this.push(change.showId, change.seats);
      }
    });
  }

  // Checked before the stream opens, so an unknown show is a plain 404.
  @Sse("shows/:id/events")
  async stream(@Param("id") id: string): Promise<Observable<MessageEvent>> {
    const showId = parse(showIdSchema, id);
    const first = await this.shows.detail(showId);
    return new Observable<MessageEvent>((viewer) => {
      const set = this.viewers.get(showId) ?? new Set<Viewer>();
      this.viewers.set(showId, set.add(viewer));
      viewer.next({ type: "snapshot", data: { ...first, via: this.config.SERVICE_NAME } });
      const ping = setInterval(
        () => viewer.next({ type: "ping", data: { at: Date.now() } }),
        PING_MS,
      );
      return () => {
        clearInterval(ping);
        set.delete(viewer);
        if (!set.size) this.viewers.delete(showId);
      };
    });
  }

  @Get("admin/live")
  stats() {
    const perShow = Object.fromEntries([...this.viewers].map(([id, set]) => [id, set.size]));
    return { service: this.config.SERVICE_NAME, ...this.events.stats, viewers: perShow };
  }

  @Post("admin/live/drop-connection")
  @HttpCode(200)
  drop() {
    return { dropped: this.events.dropConnection() };
  }

  // One query per change per instance, however many people are watching.
  private async push(showId: string, seatNos: string[]): Promise<void> {
    try {
      const seats: Seat[] = await this.shows.seats(showId, seatNos);
      for (const viewer of this.viewers.get(showId) ?? []) {
        viewer.next({ type: "seats", data: { showId, seats } });
      }
    } catch (error) {
      this.logger.warn(`could not push seats of ${showId}: ${(error as Error).message}`);
    }
  }

  private async snapshot(showId: string, viewers: Viewer[]): Promise<void> {
    try {
      const detail = await this.shows.detail(showId);
      for (const v of viewers)
        v.next({ type: "snapshot", data: { ...detail, via: this.config.SERVICE_NAME } });
    } catch (error) {
      this.logger.warn(`could not resync ${showId}: ${(error as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe();
    for (const set of this.viewers.values()) for (const v of set) v.complete();
  }
}
