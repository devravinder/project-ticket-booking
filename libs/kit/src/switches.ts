import { Body, Controller, Get, Inject, Injectable, Logger, Put } from "@nestjs/common";
import { fail } from "./util.js";

export type SwitchValue = string | number | boolean;
export type SwitchDefaults = Record<string, SwitchValue>;

export const SWITCH_DEFAULTS = Symbol("SWITCH_DEFAULTS");

// Runtime knobs for demos and tests (failure injection, modes). In memory: a restart resets them.
@Injectable()
export class Switches {
  private readonly logger = new Logger(Switches.name);
  private readonly values: Map<string, SwitchValue>;

  constructor(@Inject(SWITCH_DEFAULTS) private readonly defaults: SwitchDefaults) {
    this.values = new Map(Object.entries(defaults));
  }

  get<T extends SwitchValue>(name: string): T {
    if (!this.values.has(name)) throw new Error(`unknown switch ${name}`);
    return this.values.get(name) as T;
  }

  all(): SwitchDefaults {
    return Object.fromEntries(this.values);
  }

  // Each value must have the type of its default, so a typo cannot silently create a new switch.
  set(patch: Record<string, unknown>): SwitchDefaults {
    for (const [name, value] of Object.entries(patch)) {
      if (!(name in this.defaults)) fail(400, "UNKNOWN_SWITCH", `unknown switch ${name}`);
      if (typeof value !== typeof this.defaults[name]) {
        fail(400, "INVALID_SWITCH", `${name} must be a ${typeof this.defaults[name]}`);
      }
    }
    for (const [name, value] of Object.entries(patch)) {
      this.values.set(name, value as SwitchValue);
      this.logger.warn(`switch ${name} = ${JSON.stringify(value)}`);
    }
    return this.all();
  }

  reset(): SwitchDefaults {
    for (const [name, value] of Object.entries(this.defaults)) this.values.set(name, value);
    return this.all();
  }
}

@Controller("admin/switches")
export class SwitchesController {
  constructor(@Inject(Switches) private readonly switches: Switches) {}

  @Get()
  list() {
    return this.switches.all();
  }

  @Put()
  update(@Body() body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      fail(400, "INVALID_REQUEST", "expected an object of switch values");
    }
    return this.switches.set(body as Record<string, unknown>);
  }

  @Put("reset")
  reset() {
    return this.switches.reset();
  }
}
