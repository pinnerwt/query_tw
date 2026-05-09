-- posts: one row per scraped Threads post (job_count = 0 means non-job/spam)
CREATE TABLE posts (
  id            BYTEA PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  author_handle TEXT NOT NULL,
  author_name   TEXT,
  posted_at     TIMESTAMPTZ NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  stitched      BOOLEAN NOT NULL DEFAULT false,
  job_count     INT NOT NULL DEFAULT 0,
  spam_score    REAL,
  raw_text      TEXT,
  raw_extraction JSONB,
  extraction_failed BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE jobs (
  id          BYTEA PRIMARY KEY,
  post_id     BYTEA NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  ordinal     INT NOT NULL,
  title       TEXT NOT NULL,
  company     TEXT,
  city        TEXT,
  district    TEXT,
  remote      BOOLEAN NOT NULL DEFAULT false,
  job_type    TEXT NOT NULL DEFAULT 'full_time',
  pay_min     INT,
  pay_max     INT,
  pay_period  TEXT,
  pay_raw     TEXT,
  language    TEXT,
  raw_excerpt TEXT,
  posted_at   TIMESTAMPTZ NOT NULL,
  spam_score  REAL NOT NULL DEFAULT 0,
  search_tsv  TSVECTOR,
  UNIQUE (post_id, ordinal)
);

CREATE INDEX jobs_posted_at_idx ON jobs (posted_at DESC, id DESC);
CREATE INDEX jobs_city_idx      ON jobs (city) WHERE city IS NOT NULL;
CREATE INDEX jobs_search_idx    ON jobs USING GIN (search_tsv);

CREATE TABLE skills (
  id        SERIAL PRIMARY KEY,
  canonical TEXT NOT NULL UNIQUE,
  aliases   TEXT[] NOT NULL DEFAULT '{}',
  approved  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE roles (
  id        SERIAL PRIMARY KEY,
  canonical TEXT NOT NULL UNIQUE,
  aliases   TEXT[] NOT NULL DEFAULT '{}',
  approved  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE job_skills (
  job_id    BYTEA NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id  INT   NOT NULL REFERENCES skills(id),
  years_min INT,
  PRIMARY KEY (job_id, skill_id)
);
CREATE INDEX job_skills_skill_idx ON job_skills (skill_id, years_min);

CREATE TABLE job_experience (
  job_id    BYTEA NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  role_id   INT   NOT NULL REFERENCES roles(id),
  years_min INT,
  PRIMARY KEY (job_id, role_id)
);
CREATE INDEX job_experience_role_idx ON job_experience (role_id, years_min);

CREATE TABLE job_languages (
  job_id   BYTEA NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  language TEXT  NOT NULL,
  level    TEXT,
  PRIMARY KEY (job_id, language)
);

CREATE TABLE job_tags (
  job_id BYTEA NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tag    TEXT  NOT NULL,
  PRIMARY KEY (job_id, tag)
);

CREATE TABLE daily_reports (
  date    DATE PRIMARY KEY,
  payload JSONB NOT NULL
);
