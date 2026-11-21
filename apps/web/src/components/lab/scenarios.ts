import type { Booking, Hold } from "@tix/contracts";
import { api, type Switches } from "../../api.js";

export type Ctx = {
  user: string;
  showId: string;
  step: (text: string) => void;
  hold: (count?: number) => Promise<Hold>;
  checkout: (hold: Hold) => Promise<Booking>;
  pay: (booking: Booking, outcome?: "approve" | "decline") => Promise<void>;
  verify: (booking: Booking, via?: "booking" | "booking-2") => Promise<void>;
  waitFor: (booking: Booking, done: (b: Booking) => boolean, ms?: number) => Promise<Booking>;
  sleep: (ms: number) => Promise<void>;
};

export type Scenario = {
  id: string;
  title: string;
  explain: string;
  expect: string;
  booking?: Switches;
  gateway?: Switches;
  run: (ctx: Ctx) => Promise<Booking>;
};

const final = (b: Booking) => b.status !== "PENDING_PAYMENT";

export const CHECKOUT_SCENARIOS: Scenario[] = [
  {
    id: "happy",
    title: "Pay, webhook confirms",
    explain: "Hold, check out, approve on the gateway. The signed webhook books the seat.",
    expect: "CONFIRMED",
    run: async (x) => {
      const b = await x.checkout(await x.hold());
      await x.pay(b);
      return x.waitFor(b, final);
    },
  },
  {
    id: "declined",
    title: "Card declined",
    explain: "The gateway says no. The seats go back on sale at once, not after the hold expires.",
    expect: "PAYMENT_FAILED",
    run: async (x) => {
      const b = await x.checkout(await x.hold(2));
      await x.pay(b, "decline");
      return x.waitFor(b, final);
    },
  },
  {
    id: "duplicate",
    title: "Every webhook arrives twice",
    explain:
      "At-least-once delivery. The inbox table remembers event ids; the second one is ignored.",
    expect: "CONFIRMED",
    gateway: { duplicateWebhooks: true },
    run: async (x) => {
      const b = await x.checkout(await x.hold());
      await x.pay(b);
      await x.waitFor(b, final);
      await x.sleep(1000);
      return api.booking(b.id);
    },
  },
  {
    id: "lost-webhook",
    title: "Webhook lost, customer comes back",
    explain:
      "The webhook never arrives. The return to the shop makes us ask the gateway, which says PAID.",
    expect: "CONFIRMED",
    gateway: { dropWebhooks: true },
    run: async (x) => {
      const b = await x.checkout(await x.hold());
      await x.pay(b);
      await x.sleep(1000);
      x.step("still waiting: no webhook. Now the customer is redirected back…");
      await x.verify(b);
      return x.waitFor(b, final);
    },
  },
  {
    id: "race",
    title: "Webhook and two returns at the same time",
    explain:
      "The webhook and two returns (one per instance) race. The booking row lock lets one book; the others see 'already handled'.",
    expect: "CONFIRMED",
    run: async (x) => {
      const b = await x.checkout(await x.hold());
      await x.pay(b);
      await Promise.all([x.verify(b, "booking"), x.verify(b, "booking-2").catch(() => undefined)]);
      return x.waitFor(b, final);
    },
  },
  {
    id: "abandoned",
    title: "Customer walks away",
    explain: "Nobody pays. An 8-second hold ends, the seat is free again and the booking expires.",
    expect: "EXPIRED",
    booking: { holdTtlMs: 8000, paymentMarginMs: 2000 },
    run: async (x) => {
      const b = await x.checkout(await x.hold());
      x.step("not paying; waiting for the hold to end…");
      return x.waitFor(b, final, 15_000);
    },
  },
];

// The slow bank answers after the 8 s hold ended; the payment session closed at 6 s.
const LATE = {
  booking: { holdTtlMs: 8000, paymentMarginMs: 2000 },
  gateway: { slowPayMs: 10_000 },
};

export const FAILURE_SCENARIOS: Scenario[] = [
  {
    id: "late-free",
    title: "Paid late, seat still free",
    explain:
      "The customer presses Pay in time but the bank answers after the hold ended. Nobody took the seat, so it is booked anyway.",
    expect: "CONFIRMED",
    ...LATE,
    run: async (x) => {
      const b = await x.checkout(await x.hold());
      const paying = x.pay(b);
      await x.waitFor(b, (n) => n.status === "EXPIRED", 12_000);
      x.step("the hold ended while the bank was still thinking");
      await paying;
      return x.waitFor(b, (n) => n.status !== "EXPIRED", 8000);
    },
  },
  {
    id: "late-taken",
    title: "Paid late, seat resold",
    explain:
      "Same slow bank, but a rival grabs the seat the moment the hold ends. The money goes back automatically.",
    expect: "REFUNDED",
    ...LATE,
    run: async (x) => {
      const h = await x.hold();
      const b = await x.checkout(h);
      const paying = x.pay(b);
      await x.waitFor(b, (n) => n.status === "EXPIRED", 12_000);
      const rival = await api.hold("lab-rival", x.showId, h.seats);
      x.step(`lab-rival takes ${rival.seats.join(", ")} right after the hold ended`);
      await paying;
      const done = await x.waitFor(b, (n) => n.status === "REFUNDED", 15_000);
      await api.release("lab-rival", rival.id).catch(() => undefined);
      return done;
    },
  },
  {
    id: "reconcile",
    title: "Paid, but we never heard",
    explain:
      "The webhook is lost and the customer closes the tab. After 3 s reconciliation asks the gateway and books the seat.",
    expect: "CONFIRMED",
    booking: { reconcileAfterMs: 3000 },
    gateway: { dropWebhooks: true },
    run: async (x) => {
      const b = await x.checkout(await x.hold());
      await x.pay(b);
      x.step("no webhook, no return; waiting for reconciliation…");
      return x.waitFor(b, (n) => n.status !== "PENDING_PAYMENT", 15_000);
    },
  },
  {
    id: "down",
    title: "Our webhook endpoint is down",
    explain:
      "Webhooks get 503 for 4 s. The gateway retries with backoff; once we are back, the next attempt confirms.",
    expect: "CONFIRMED",
    booking: { webhooksDown: true },
    run: async (x) => {
      const b = await x.checkout(await x.hold());
      await x.pay(b);
      await x.sleep(4000);
      await api.setSwitches("booking", { webhooksDown: false });
      x.step("webhook endpoint is back up");
      return x.waitFor(b, (n) => n.status !== "PENDING_PAYMENT", 15_000);
    },
  },
];
