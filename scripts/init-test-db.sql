-- Create test database for integration tests (used in local dev and CI)
-- This script runs once during postgres initialization via docker-entrypoint-initdb.d

-- Create the test user and database
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gigi_test') THEN
    CREATE ROLE gigi_test WITH LOGIN PASSWORD 'gigi_test';
  END IF;
END
$$;

-- Create test database (must be run outside transaction, handled by psql)
SELECT 'CREATE DATABASE gigi_test OWNER gigi_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gigi_test')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE gigi_test TO gigi_test;
