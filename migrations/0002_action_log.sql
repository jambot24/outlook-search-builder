-- Append-only log of writes, used for daily rate limits. Deleting a search or clearing a
-- vote removes rows elsewhere but never here, so limits cannot be reset by churning.
CREATE TABLE action_log (
  actor      TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('submission', 'vote', 'report')),
  created_at TEXT NOT NULL
);
CREATE INDEX action_log_actor ON action_log (actor, kind, created_at);
