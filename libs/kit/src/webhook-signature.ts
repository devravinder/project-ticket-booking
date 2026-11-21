import { createHmac, timingSafeEqual } from "node:crypto";

// Same scheme as Stripe: HMAC-SHA256 over "<unix seconds>.<raw body>".
export const SIGNATURE_HEADER = "gateway-signature";

// Older signatures are refused, so a captured request cannot be replayed later.
export const SIGNATURE_TOLERANCE_S = 300;

export function signWebhook(secret: string, body: string, at = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return `t=${at},v1=${v1}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifyWebhook(
  secret: string,
  body: string,
  header: string | undefined,
  now = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!header) return { ok: false, reason: "missing signature" };
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=", 2) as [string, string]),
  );
  const at = Number(parts.t);
  if (!Number.isInteger(at) || !parts.v1) return { ok: false, reason: "malformed signature" };
  if (Math.abs(now - at) > SIGNATURE_TOLERANCE_S) return { ok: false, reason: "signature too old" };
  const expected = Buffer.from(signWebhook(secret, body, at).split("v1=")[1]!, "hex");
  const given = Buffer.from(parts.v1, "hex");
  // Constant time, so the comparison does not leak how many characters matched.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
