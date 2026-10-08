-- OPTIONAL hardening. NOT applied automatically: review, then run once in the Supabase SQL editor.
-- The app connects server-side only; the Supabase API roles never need table access.
-- Reversible with GRANT. Skips roles that do not exist.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- Also recommended (dashboard): connect the app with a dedicated least-privilege role instead of `postgres`.
