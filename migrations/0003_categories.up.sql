CREATE TABLE categories (
  id        SERIAL PRIMARY KEY,
  canonical TEXT NOT NULL UNIQUE,
  aliases   TEXT[] NOT NULL DEFAULT '{}',
  approved  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE job_categories (
  job_id      BYTEA NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  category_id INT   NOT NULL REFERENCES categories(id),
  PRIMARY KEY (job_id, category_id)
);
CREATE INDEX job_categories_category_idx ON job_categories (category_id);
