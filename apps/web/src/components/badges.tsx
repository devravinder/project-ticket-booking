import type { BookingStatus } from "@tix/contracts";

const STYLE: Record<BookingStatus, string> = {
  PENDING_PAYMENT: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-green-100 text-green-900",
  PAYMENT_FAILED: "bg-red-100 text-red-900",
  EXPIRED: "bg-gray-200 text-gray-800",
  REFUND_PENDING: "bg-orange-100 text-orange-900",
  REFUNDED: "bg-purple-100 text-purple-900",
};

const TEXT: Record<BookingStatus, string> = {
  PENDING_PAYMENT: "waiting for payment",
  CONFIRMED: "confirmed",
  PAYMENT_FAILED: "payment failed",
  EXPIRED: "expired",
  REFUND_PENDING: "refund pending",
  REFUNDED: "refunded",
};

export function BookingBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold ${STYLE[status]}`}
      data-status={status}
    >
      {TEXT[status]}
    </span>
  );
}
