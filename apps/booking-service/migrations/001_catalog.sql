CREATE TABLE movies (
  id text PRIMARY KEY,
  title text NOT NULL,
  minutes int NOT NULL CHECK (minutes > 0),
  rating text NOT NULL
);

-- A screen's physical layout; every show on it copies these seats.
CREATE TABLE screens (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE screen_seats (
  screen_id text NOT NULL REFERENCES screens,
  seat_no text NOT NULL,
  row_label text NOT NULL,
  col int NOT NULL CHECK (col > 0),
  tier text NOT NULL CHECK (tier IN ('REGULAR', 'PREMIUM')),
  PRIMARY KEY (screen_id, seat_no)
);

CREATE TABLE shows (
  id text PRIMARY KEY,
  movie_id text NOT NULL REFERENCES movies,
  screen_id text NOT NULL REFERENCES screens,
  starts_at timestamptz NOT NULL,
  regular_cents int NOT NULL CHECK (regular_cents > 0),
  premium_cents int NOT NULL CHECK (premium_cents > 0)
);

-- One row per seat per show: the row that concurrent buyers fight over.
CREATE TABLE show_seats (
  show_id text NOT NULL REFERENCES shows ON DELETE CASCADE,
  seat_no text NOT NULL,
  row_label text NOT NULL,
  col int NOT NULL,
  tier text NOT NULL,
  price_cents int NOT NULL CHECK (price_cents > 0),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'HELD', 'BOOKED')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (show_id, seat_no)
);

INSERT INTO movies (id, title, minutes, rating) VALUES
  ('interstellar', 'Interstellar', 169, 'UA'),
  ('dune-2', 'Dune: Part Two', 166, 'UA'),
  ('spirited-away', 'Spirited Away', 125, 'U'),
  ('rrr', 'RRR', 182, 'UA');

INSERT INTO screens (id, name) VALUES ('AUDI-1', 'Audi 1'), ('AUDI-2', 'Audi 2 (small)');

-- Audi 1: rows A-H x 12; G and H are premium. Audi 2: rows A-D x 8, all regular.
INSERT INTO screen_seats (screen_id, seat_no, row_label, col, tier)
SELECT 'AUDI-1', r || c, r, c, CASE WHEN r IN ('G', 'H') THEN 'PREMIUM' ELSE 'REGULAR' END
FROM unnest(ARRAY['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) AS r, generate_series(1, 12) AS c;

INSERT INTO screen_seats (screen_id, seat_no, row_label, col, tier)
SELECT 'AUDI-2', r || c, r, c, 'REGULAR'
FROM unnest(ARRAY['A', 'B', 'C', 'D']) AS r, generate_series(1, 8) AS c;

INSERT INTO shows (id, movie_id, screen_id, starts_at, regular_cents, premium_cents) VALUES
  ('SHOW-1', 'interstellar', 'AUDI-1', date_trunc('day', now()) + interval '1 day 18 hours', 20000, 35000),
  ('SHOW-2', 'dune-2', 'AUDI-1', date_trunc('day', now()) + interval '1 day 21 hours 30 minutes', 22000, 38000),
  ('SHOW-3', 'spirited-away', 'AUDI-2', date_trunc('day', now()) + interval '1 day 15 hours', 15000, 15000),
  ('SHOW-4', 'rrr', 'AUDI-2', date_trunc('day', now()) + interval '1 day 20 hours', 18000, 18000);

INSERT INTO show_seats (show_id, seat_no, row_label, col, tier, price_cents)
SELECT s.id, ss.seat_no, ss.row_label, ss.col, ss.tier,
       CASE ss.tier WHEN 'PREMIUM' THEN s.premium_cents ELSE s.regular_cents END
FROM shows s JOIN screen_seats ss USING (screen_id);
