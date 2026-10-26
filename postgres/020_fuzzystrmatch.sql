-- 020: fuzzystrmatch (dmetaphone, levenshtein) used by matching. Already installed by hand on
-- existing instances; this makes fresh databases (tests, new installs) complete.
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch SCHEMA mdm;
