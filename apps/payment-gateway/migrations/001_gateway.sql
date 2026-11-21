-- A payment session: the merchant asks for an amount, the customer pays on our page.
CREATE TABLE sessions (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  merchant_ref text NOT NULL,
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  return_url text NOT NULL,
  webhook_url text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PROCESSING', 'PAID', 'DECLINED', 'EXPIRED', 'REFUNDED')),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_by_ref ON sessions (merchant_ref);

-- One full refund per session; the key makes a retried refund request harmless.
CREATE TABLE refunds (
  id text PRIMARY KEY,
  session_id text NOT NULL UNIQUE REFERENCES sessions,
  idempotency_key text NOT NULL UNIQUE,
  amount_cents int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Webhook outbox: written with the status change, delivered with retries until acknowledged.
CREATE TABLE webhook_events (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions,
  type text NOT NULL,
  payload jsonb NOT NULL,
  url text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'DROPPED', 'GAVE_UP')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_events_due ON webhook_events (next_attempt_at) WHERE status = 'PENDING';
