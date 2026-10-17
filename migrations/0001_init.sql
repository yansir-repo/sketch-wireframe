-- A published sketch is data: one row per project (the capability key lives here, so the URL can always
-- be recovered), one row per version (the JSON the engine renders). The engine is deployed once.
CREATE TABLE sketches (
  code        TEXT PRIMARY KEY,          -- lowercase slug, e.g. "mz-007"
  key         TEXT NOT NULL,             -- 16 hex chars from a CSPRNG: the gate in /s/<code>.<key>
  version     INTEGER NOT NULL,          -- the version currently served
  title       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL,             -- an email, or service:<client id>
  deleted_at  INTEGER                    -- soft delete: the URL stops working, history stays
);

CREATE TABLE sketch_versions (
  code        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  json        TEXT NOT NULL,             -- the validated Sketch, serialised
  created_at  INTEGER NOT NULL,
  created_by  TEXT NOT NULL,
  PRIMARY KEY (code, version)
);
