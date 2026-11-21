import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { type BaseConfig, SERVICE_CONFIG } from "./config.js";

// Connects on first use, so a service without REDIS_URL never opens a connection.
@Injectable()
export class Redis implements OnModuleDestroy {
  private client?: RedisClientType;
  private connecting?: Promise<unknown>;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: BaseConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.REDIS_URL);
  }

  async connected(): Promise<RedisClientType> {
    if (!this.config.REDIS_URL) throw new Error("REDIS_URL is not set");
    if (!this.client) {
      // Fail fast while disconnected instead of queueing commands until a timeout.
      this.client = createClient({ url: this.config.REDIS_URL, disableOfflineQueue: true });
      // Without a listener, a lost connection is an unhandled error that kills the process.
      this.client.on("error", () => undefined);
    }
    const client = this.client;
    this.connecting ??= client.connect().catch((error: unknown) => {
      this.connecting = undefined;
      throw error;
    });
    await this.connecting;
    return client;
  }

  async ping(): Promise<string> {
    return `redis ${await (await this.connected()).ping()}`;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) await this.client.close();
  }
}
