CREATE TABLE announcements (
    id          BIGSERIAL PRIMARY KEY,
    severity    TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX announcements_order_idx
    ON announcements ((severity = 'critical') DESC, created_at DESC);
