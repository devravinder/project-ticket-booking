-- One booking per hold: the checkout of those seats and the payment for it.
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL UNIQUE REFERENCES holds ON DELETE CASCADE,
  show_id text NOT NULL REFERENCES shows ON DELETE CASCADE,
  user_name text NOT NULL,
  seat_nos text[] NOT NULL,
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN
    ('PENDING_PAYMENT', 'CONFIRMED', 'PAYMENT_FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED')),
  session_id text UNIQUE,
  pay_url text,
  payment_expires_at timestamptz NOT NULL,
  failure_reason text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bookings_by_user ON bookings (user_name, created_at DESC);
CREATE INDEX bookings_open ON bookings (status) WHERE status IN ('PENDING_PAYMENT', 'EXPIRED', 'REFUND_PENDING');

-- A seat row can point at one booking only: the last line of defence against double booking.
ALTER TABLE show_seats
  ADD COLUMN booking_id uuid REFERENCES bookings ON DELETE SET NULL,
  ADD CONSTRAINT booked_has_booking CHECK ((status = 'BOOKED') = (booking_id IS NOT NULL));

-- Webhook event ids already handled: a duplicate delivery is acknowledged and ignored.
CREATE TABLE webhook_inbox (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  session_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- What happened to a booking, in order; shown as its timeline.
CREATE TABLE booking_log (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  what text NOT NULL,
  detail text
);

CREATE INDEX booking_log_by_booking ON booking_log (booking_id, id);
