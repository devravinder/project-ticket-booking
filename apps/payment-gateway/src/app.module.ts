import { Module } from "@nestjs/common";
import { baseEnvSchema, KitModule, loadConfig } from "@tix/kit";

// A fake payment provider: an external company in real life, so its own database.
@Module({
  imports: [KitModule.forService(loadConfig(baseEnvSchema))],
})
export class AppModule {}
