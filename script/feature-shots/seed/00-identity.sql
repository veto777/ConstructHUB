-- Sample identity for the feature-shot lane (constructhub_dev_<lane> only).
-- Idempotent-ish (a fixed rename of user 1) and guarded like every other seed:
-- it refuses to run unless the target is a constructhub_dev_* lane database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'constructhub\_dev\_%' THEN
    RAISE EXCEPTION 'refusing to seed %: lane databases (constructhub_dev_*) only', current_database();
  END IF;
END $$;
UPDATE users SET display_name = 'Sam Rivera', company_name = 'Summit Roofing Co.' WHERE id::text = '1';
COMMIT;
