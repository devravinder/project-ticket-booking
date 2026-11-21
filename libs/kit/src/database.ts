import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import pg from "pg";
import { type BaseConfig, SERVICE_CONFIG } from "./config.js";

// Any constant works; it only has to be the same for every instance of one service.
const MIGRATION_LOCK = 4242;

export type Tx = pg.PoolClient;

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  readonly pool: pg.Pool;

  constructor(@Inject(SERVICE_CONFIG) readonly config: BaseConfig) {
    this.pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 20 });
    // An idle client losing its connection must not crash the process.
    this.pool.on("error", (error) => this.logger.warn(`idle client error: ${error.message}`));
  }

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
    return this.pool.query<R>(text, values);
  }

  async tx<T>(fn: (client: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<string> {
    const { rows } = await this.query<{ db: string; who: string }>(
      "SELECT current_database() AS db, current_user AS who",
    );
    return `postgres ${rows[0]!.db} as ${rows[0]!.who}`;
  }

  // Applies migrations/NNN_*.sql in name order, each once, each in its own transaction.
  // The advisory lock stops two instances starting together from both applying a file.
  async migrate(dir: string): Promise<string[]> {
    const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".sql")).sort();
    const client = await this.pool.connect();
    const applied: string[] = [];
    try {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const done = new Set(
        (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
          (r) => r.name,
        ),
      );
      for (const file of files.filter((f) => !done.has(f))) {
        await client.query("BEGIN");
        try {
          await client.query(await readFile(join(dir, file), "utf8"));
          await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
          await client.query("COMMIT");
          applied.push(file);
        } catch (error) {
          await client.query("ROLLBACK");
          throw new Error(`migration ${file} failed: ${(error as Error).message}`);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
      client.release();
    }
    return applied;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
