import { Body, Controller, Get, HttpException, Inject, Param, Post, Res } from "@nestjs/common";
import type { GatewaySession } from "@tix/contracts";
import { Switches } from "@tix/kit";
import type { Response } from "express";
import { SessionsService } from "./sessions.service.js";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const rupees = (cents: number) => `₹${(cents / 100).toFixed(2)}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#eef2ff;display:flex;justify-content:center;padding:3rem}
main{background:#fff;border-radius:12px;box-shadow:0 2px 8px #0002;padding:2rem;width:24rem}
h1{font-size:1.1rem;color:#3730a3;margin:0 0 1rem} .amount{font-size:2rem;font-weight:700}
button{width:100%;padding:.7rem;margin-top:.6rem;border-radius:8px;border:0;font-size:1rem;cursor:pointer}
.pay{background:#4338ca;color:#fff} .decline{background:#fee2e2;color:#991b1b}
button:disabled{opacity:.4;cursor:not-allowed} small{color:#6b7280}
</style></head><body><main><h1>FakePay · test mode</h1>${body}</main></body></html>`;
}

// The hosted pay page: in real life the customer's card details are typed here, not at the merchant.
@Controller("pay")
export class PayPageController {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(Switches) private readonly switches: Switches,
  ) {}

  @Get(":id")
  async show(@Param("id") id: string, @Res() res: Response) {
    const s = await this.load(id, res);
    if (!s) return;
    const open = s.status === "OPEN";
    res.type("html").send(
      page(
        "Pay",
        `<p>Pay <b>${escape(s.merchantRef)}</b></p>
<p class="amount" id="amount">${rupees(s.amountCents)}</p>
<p>Status: <b id="status">${s.status}</b> · <span id="left" data-expires="${s.expiresAt}"></span></p>
<form method="post" action="/pay/${encodeURIComponent(s.id)}">
<button class="pay" name="outcome" value="approve" ${open ? "" : "disabled"}>Pay ${rupees(s.amountCents)}</button>
<button class="decline" name="outcome" value="decline" ${open ? "" : "disabled"}>Decline (test card 4000 0000 0000 0002)</button>
</form>
<p><small>Session ${escape(s.id)}. Nothing is charged: this gateway is fake.</small></p>
<script>
const el = document.getElementById("left");
const end = new Date(el.dataset.expires).getTime();
const tick = () => {
  const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  el.textContent = s ? "session ends in " + s + " s" : "session ended";
  if (!s) document.querySelectorAll("button").forEach((b) => (b.disabled = true));
};
tick(); setInterval(tick, 500);
</script>`,
      ),
    );
  }

  // A real redirect back is a hint for the UI only; the merchant must confirm server-side.
  @Post(":id")
  async submit(@Param("id") id: string, @Body() body: { outcome?: string }, @Res() res: Response) {
    const outcome = body?.outcome === "approve" ? "approve" : "decline";
    let session: GatewaySession;
    try {
      session = await this.sessions.pay(id, outcome);
    } catch (error) {
      const s = await this.load(id, res);
      if (!s) return;
      const message =
        error instanceof HttpException
          ? (error.getResponse() as { message: string }).message
          : "error";
      res
        .status(409)
        .type("html")
        .send(page("Payment", `<p>Could not pay: ${escape(message)}.</p>${this.back(s)}`));
      return;
    }
    if (this.switches.get<boolean>("redirectBack")) {
      res.redirect(303, this.returnTo(session));
      return;
    }
    // Lab: the customer closes the tab, so only the webhook can tell the merchant.
    res
      .status(200)
      .type("html")
      .send(
        page(
          "Done",
          `<p>Payment <b id="status">${session.status}</b>.</p><p>You can close this tab.</p>`,
        ),
      );
  }

  private back(s: GatewaySession): string {
    return `<p><a href="${escape(this.returnTo(s))}">Back to the shop</a></p>`;
  }

  private returnTo(s: GatewaySession): string {
    const url = new URL(s.returnUrl);
    url.searchParams.set("session", s.id);
    url.searchParams.set("status", s.status);
    return url.toString();
  }

  private async load(id: string, res: Response): Promise<GatewaySession | null> {
    try {
      return await this.sessions.get(id);
    } catch {
      res.status(404).type("html").send(page("Not found", "<p>No such payment session.</p>"));
      return null;
    }
  }
}
