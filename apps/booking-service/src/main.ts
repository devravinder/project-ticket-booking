import { fileURLToPath } from "node:url";
import { bootstrap } from "@tix/kit";
import { AppModule } from "./app.module.js";

await bootstrap(AppModule, fileURLToPath(new URL("../migrations", import.meta.url)));
