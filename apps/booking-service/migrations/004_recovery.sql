-- When the reconciliation or refund job may look at a booking again (backoff between checks).
ALTER TABLE bookings
  ADD COLUMN next_check_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN checks int NOT NULL DEFAULT 0,
  -- Set once the gateway gave a final answer; such a booking is not asked about again.
  ADD COLUMN settled_at timestamptz;

CREATE INDEX bookings_to_check ON bookings (next_check_at)
  WHERE settled_at IS NULL AND status IN ('PENDING_PAYMENT', 'EXPIRED', 'REFUND_PENDING');
