import { randomBytes } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { QueueStats, QueueTicket } from "@tix/contracts";
import { fail, Redis, Switches } from "@tix/kit";

const TICK_MS = 250;
const SHOWS = "wr:shows";
const key = {
  queue: (show: string) => `wr:{${show}}:queue`,
  admitted: (show: string) => `wr:{${show}}:admitted:`,
  count: (show: string) => `wr:{${show}}:admitted-count`,
  tick: (show: string, second: number) => `wr:{${show}}:tick:${second}`,
};

// One Redis round trip, atomic: only the first instance per second admits, pop and token together.
const ADMIT = `
if redis.call('SET', KEYS[2], '1', 'NX', 'EX', 5) == false then return {} end
local popped = redis.call('ZPOPMIN', KEYS[1], ARGV[1])
local admitted = {}
for i = 1, #popped, 2 do
  local user = popped[i]
  redis.call('SET', ARGV[3] .. user, ARGV[4 + (i - 1) / 2], 'PX', ARGV[2])
  admitted[#admitted + 1] = user
end
if #admitted > 0 then redis.call('INCRBY', KEYS[3], #admitted) end
return admitted`;

// A FIFO line per show in Redis; N people per second get a token that lets them hold seats (ADR-012).
@Injectable()
export class WaitingRoom implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WaitingRoom.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    @Inject(Redis) private readonly redis: Redis,
    @Inject(Switches) private readonly switches: Switches,
  ) {}

  get enabled(): boolean {
    return this.switches.get<boolean>("waitingRoom");
  }

  // Joining twice keeps your place (ZADD NX).
  async join(show: string, user: string): Promise<QueueTicket> {
    if (!this.enabled) return { status: "OPEN", waiting: 0 };
    const admitted = await this.admission(show, user);
    if (admitted) return admitted;
    await this.cmd(["ZADD", key.queue(show), "NX", String(Date.now()), user]);
    await this.cmd(["SADD", SHOWS, show]);
    return this.position(show, user);
  }

  async me(show: string, user: string): Promise<QueueTicket> {
    if (!this.enabled) return { status: "OPEN", waiting: 0 };
    return (await this.admission(show, user)) ?? (await this.position(show, user));
  }

  async stats(show: string): Promise<QueueStats> {
    const enabled = this.enabled;
    const admitPerSecond = this.switches.get<number>("admitPerSecond");
    if (!this.redis.enabled) return { enabled, admitPerSecond, waiting: 0, admittedTotal: 0 };
    const [waiting, count] = await Promise.all([
      this.cmd(["ZCARD", key.queue(show)]),
      this.cmd(["GET", key.count(show)]),
    ]);
    return { enabled, admitPerSecond, waiting: Number(waiting), admittedTotal: Number(count ?? 0) };
  }

  // Called before a hold. Off: anyone may hold. On: only with a live admission token.
  async requireAdmission(show: string, user: string, token: string | undefined): Promise<void> {
    if (!this.enabled) return;
    const expected = await this.cmd(["GET", `${key.admitted(show)}${user}`]);
    if (!token || token !== expected) {
      fail(403, "QUEUE_REQUIRED", "this show has a waiting room; join the queue first");
    }
  }

  async reset(show: string): Promise<void> {
    const client = await this.redis.connected();
    const keys: string[] = [];
    for await (const batch of client.scanIterator({ MATCH: `wr:{${show}}:*`, COUNT: 200 })) {
      keys.push(...(Array.isArray(batch) ? batch : [batch]));
    }
    if (keys.length) await this.cmd(["DEL", ...keys]);
    await this.cmd(["SREM", SHOWS, show]);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.admit().finally(() => {
        this.running = null;
      });
    }, TICK_MS);
  }

  private async admit(): Promise<void> {
    if (!this.enabled || !this.redis.enabled) return;
    try {
      const shows = (await this.cmd(["SMEMBERS", SHOWS])) as string[];
      const n = this.switches.get<number>("admitPerSecond");
      const ttl = this.switches.get<number>("admissionTtlMs");
      const second = Math.floor(Date.now() / 1000);
      for (const show of shows) {
        const tokens = Array.from({ length: n }, () => randomBytes(12).toString("base64url"));
        const admitted = (await this.cmd([
          "EVAL",
          ADMIT,
          "3",
          key.queue(show),
          key.tick(show, second),
          key.count(show),
          String(n),
          String(ttl),
          key.admitted(show),
          ...tokens,
        ])) as string[];
        if (admitted.length) this.logger.log(`${show}: admitted ${admitted.join(", ")}`);
        if (Number(await this.cmd(["ZCARD", key.queue(show)])) === 0)
          await this.cmd(["SREM", SHOWS, show]);
      }
    } catch (error) {
      this.logger.warn(`admit tick failed: ${(error as Error).message}`);
    }
  }

  private async admission(show: string, user: string): Promise<QueueTicket | null> {
    const k = `${key.admitted(show)}${user}`;
    const [token, ttl] = await Promise.all([this.cmd(["GET", k]), this.cmd(["PTTL", k])]);
    if (!token) return null;
    return {
      status: "ADMITTED",
      waiting: Number(await this.cmd(["ZCARD", key.queue(show)])),
      token: String(token),
      admittedUntil: new Date(Date.now() + Number(ttl)).toISOString(),
    };
  }

  private async position(show: string, user: string): Promise<QueueTicket> {
    const [rank, waiting] = await Promise.all([
      this.cmd(["ZRANK", key.queue(show), user]),
      this.cmd(["ZCARD", key.queue(show)]),
    ]);
    if (rank === null) return { status: "NOT_IN_QUEUE", waiting: Number(waiting) };
    const position = Number(rank) + 1;
    const perSecond = this.switches.get<number>("admitPerSecond");
    return {
      status: "WAITING",
      position,
      waiting: Number(waiting),
      etaSeconds: Math.ceil(position / perSecond),
    };
  }

  // Redis down while the room is on: fail closed with a clear 503, never let everyone in.
  private async cmd(args: string[]): Promise<unknown> {
    try {
      return await (await this.redis.connected()).sendCommand(args);
    } catch (error) {
      fail(503, "QUEUE_UNAVAILABLE", `waiting room unavailable: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
