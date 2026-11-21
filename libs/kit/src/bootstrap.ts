import "reflect-metadata";
import { Logger, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type BaseConfig, SERVICE_CONFIG } from "./config.js";
import { Database } from "./database.js";

// Migrations run before the port opens. rawBody lets webhook handlers verify signatures.
export async function bootstrap(appModule: Type, migrationsDir: string): Promise<void> {
  const app = await NestFactory.create(appModule, { rawBody: true });
  app.enableShutdownHooks();
  const config = app.get<BaseConfig>(SERVICE_CONFIG);
  const logger = new Logger(config.SERVICE_NAME);
  const applied = await app.get(Database).migrate(migrationsDir);
  logger.log(applied.length ? `migrations applied: ${applied.join(", ")}` : "schema up to date");
  await app.listen(config.PORT);
  logger.log(`listening on http://localhost:${config.PORT}`);
}
