import { GatewayLog } from "./gateway-log.js";
import { LiveScenario } from "./live-scenario.js";
import { RaceScenario } from "./race.js";
import { SwitchesPanel } from "./switches-panel.js";

export function Lab() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <RaceScenario />
        <LiveScenario />
        <GatewayLog />
      </div>
      <aside className="space-y-4">
        <SwitchesPanel service="booking" title="booking-service switches" />
        <SwitchesPanel service="booking-2" title="second instance switches" />
        <SwitchesPanel service="gateway" title="payment-gateway switches" />
      </aside>
    </div>
  );
}
