import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// /api/<service>/... goes to that service, e.g. /api/booking/health -> booking-service /health.
const SERVICES = { booking: "BOOKING_API", "booking-2": "BOOKING_2_API", gateway: "GATEWAY_API" };

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = Object.fromEntries(
    Object.entries(SERVICES).map(([service, variable]) => {
      const target = env[variable];
      if (command === "serve" && !target) {
        throw new Error(`Missing ${variable}. Set it in apps/web/.env.development`);
      }
      return [
        // The trailing slash keeps /api/booking from also matching /api/booking-2.
        `/api/${service}/`,
        {
          target,
          changeOrigin: true,
          rewrite: (path: string) => path.slice(`/api/${service}`.length),
        },
      ];
    }),
  );

  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5210, strictPort: true, proxy },
  };
});
