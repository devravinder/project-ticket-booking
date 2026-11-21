-- A hold reserves seats for one user until expires_at, while they pay.
CREATE TABLE holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id text NOT NULL REFERENCES shows ON DELETE CASCADE,
  user_name text NOT NULL,
  seat_nos text[] NOT NULL CHECK (cardinality(seat_nos) > 0),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'RELEASED', 'EXPIRED', 'BOOKED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The expiry sweeper reads only live holds.
CREATE INDEX holds_live ON holds (expires_at) WHERE status = 'HELD';
CREATE INDEX holds_by_user ON holds (user_name, show_id);

-- The seat row says who holds it and until when; expired means free, swept or not.
ALTER TABLE show_seats
  ADD COLUMN hold_id uuid REFERENCES holds ON DELETE SET NULL,
  ADD COLUMN hold_expires_at timestamptz,
  ADD CONSTRAINT held_has_hold CHECK ((status = 'HELD') = (hold_id IS NOT NULL AND hold_expires_at IS NOT NULL));
