import { type DynamicModule, Module } from "@nestjs/common";
import { type BaseConfig, SERVICE_CONFIG } from "./config.js";
import { Database } from "./database.js";
import { HealthController } from "./health.controller.js";
import { Redis } from "./redis.js";
import { SWITCH_DEFAULTS, type SwitchDefaults, Switches, SwitchesController } from "./switches.js";

export type KitOptions = { switches?: SwitchDefaults };

// What every service has: config, Postgres, optional Redis, switches, GET /health.
@Module({})
export class KitModule {
  static forService(config: BaseConfig, options: KitOptions = {}): DynamicModule {
    return {
      module: KitModule,
      global: true,
      controllers: [HealthController, SwitchesController],
      providers: [
        { provide: SERVICE_CONFIG, useValue: config },
        { provide: SWITCH_DEFAULTS, useValue: options.switches ?? {} },
        Database,
        Redis,
        Switches,
      ],
      exports: [SERVICE_CONFIG, Database, Redis, Switches],
    };
  }
}
