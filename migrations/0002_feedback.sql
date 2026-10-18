-- The operator is one shared token, so "who changed it" has nothing to say: drop it.
ALTER TABLE sketches DROP COLUMN updated_by;
ALTER TABLE sketch_versions DROP COLUMN created_by;

-- What the client says about a sketch. Append-only: rows are never changed or deleted.
-- kind 'note'  = a comment on one page (`path` is the page's address, `text` the comment);
-- kind 'done'  = the client closed a round: every note since the previous 'done' belongs to it.
-- `version` is the version the client was looking at (a later version may have changed the page).
CREATE TABLE feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  path        TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX feedback_code ON feedback (code, id);
