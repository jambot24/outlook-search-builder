-- Community searches, user descriptions, votes and reports.
-- moderation: 'auto' = visible unless reports >= 3 or score <= -5,
--             'approved' = always visible, 'hidden' = never visible.

CREATE TABLE searches (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  criteria     TEXT NOT NULL,
  criteria_key TEXT NOT NULL UNIQUE,
  author       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  score        INTEGER NOT NULL DEFAULT 0,
  reports      INTEGER NOT NULL DEFAULT 0,
  moderation   TEXT NOT NULL DEFAULT 'auto' CHECK (moderation IN ('auto', 'approved', 'hidden'))
);
CREATE INDEX searches_category ON searches (category, score DESC);
CREATE INDEX searches_created ON searches (created_at DESC);
CREATE INDEX searches_author ON searches (author, created_at);

CREATE TABLE descriptions (
  id         TEXT PRIMARY KEY,
  search_id  TEXT NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  author     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  score      INTEGER NOT NULL DEFAULT 0,
  reports    INTEGER NOT NULL DEFAULT 0,
  moderation TEXT NOT NULL DEFAULT 'auto' CHECK (moderation IN ('auto', 'approved', 'hidden')),
  UNIQUE (search_id, author)
);
CREATE INDEX descriptions_search ON descriptions (search_id, score DESC);
CREATE INDEX descriptions_author ON descriptions (author, created_at);

CREATE TABLE votes (
  target_type TEXT NOT NULL CHECK (target_type IN ('search', 'description')),
  target_id   TEXT NOT NULL,
  voter       TEXT NOT NULL,
  value       INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id, voter)
);
CREATE INDEX votes_voter ON votes (voter, created_at);

CREATE TABLE reports (
  target_type TEXT NOT NULL CHECK (target_type IN ('search', 'description')),
  target_id   TEXT NOT NULL,
  reporter    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id, reporter)
);
CREATE INDEX reports_reporter ON reports (reporter, created_at);
