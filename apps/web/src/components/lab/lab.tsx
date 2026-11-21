import { CheckoutLab } from "./checkout-lab.js";
import { GatewayLog } from "./gateway-log.js";
import { CHECKOUT_SCENARIOS, FAILURE_SCENARIOS } from "./scenarios.js";
import { Consistency, CrashHelp } from "./consistency.js";
import { LiveScenario } from "./live-scenario.js";
import { RaceScenario } from "./race.js";
import { SwitchesPanel } from "./switches-panel.js";

export function Lab() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <RaceScenario />
        <CheckoutLab title="Checkout and payment" scenarios={CHECKOUT_SCENARIOS} />
        <CheckoutLab title="When things go wrong" scenarios={FAILURE_SCENARIOS} />
        <LiveScenario />
        <GatewayLog />
        <CrashHelp />
      </div>
      <aside className="space-y-4">
        <Consistency />
        <SwitchesPanel service="booking" title="booking-service switches" />
        <SwitchesPanel service="booking-2" title="second instance switches" />
        <SwitchesPanel service="gateway" title="payment-gateway switches" />
      </aside>
    </div>
  );
}
