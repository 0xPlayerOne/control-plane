#!/bin/sh
set -eu

if [ -z "${PGPASSWORD:-}" ] || [ -z "${POSTGRES_MIGRATION_PASSWORD:-}" ] || [ -z "${POSTGRES_APPLICATION_PASSWORD:-}" ]; then
  echo 'PostgreSQL administrator, migration, and application passwords are required.' >&2
  exit 1
fi

case "${PGPASSWORD}${POSTGRES_MIGRATION_PASSWORD}${POSTGRES_APPLICATION_PASSWORD}" in
  *[!A-Za-z0-9._~-]*)
    echo 'PostgreSQL role passwords must be URL-safe.' >&2
    exit 1
    ;;
esac

if [ "$PGPASSWORD" = "$POSTGRES_MIGRATION_PASSWORD" ] ||
  [ "$PGPASSWORD" = "$POSTGRES_APPLICATION_PASSWORD" ] ||
  [ "$POSTGRES_MIGRATION_PASSWORD" = "$POSTGRES_APPLICATION_PASSWORD" ]; then
  echo 'PostgreSQL role passwords must be distinct.' >&2
  exit 1
fi

psql --set=ON_ERROR_STOP=1 --quiet <<SQL
SELECT 'CREATE ROLE control_plane_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'control_plane_migrator') \gexec
SELECT 'CREATE ROLE control_plane_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'control_plane_app') \gexec

ALTER ROLE control_plane_migrator
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  PASSWORD '${POSTGRES_MIGRATION_PASSWORD}';
ALTER ROLE control_plane_app
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  PASSWORD '${POSTGRES_APPLICATION_PASSWORD}';

REASSIGN OWNED BY control_plane_app TO control_plane_migrator;
REASSIGN OWNED BY control_plane TO control_plane_migrator;
SELECT format('REVOKE %I FROM control_plane_app', granted.rolname)
FROM pg_auth_members AS membership
JOIN pg_roles AS granted ON granted.oid = membership.roleid
JOIN pg_roles AS member ON member.oid = membership.member
WHERE member.rolname = 'control_plane_app' \gexec
REVOKE ALL PRIVILEGES ON DATABASE control_plane FROM control_plane_app;
SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM control_plane_app', nspname)
FROM pg_namespace
WHERE nspname IN ('public', 'drizzle') \gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM control_plane_app', nspname)
FROM pg_namespace
WHERE nspname IN ('public', 'drizzle') \gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM control_plane_app', nspname)
FROM pg_namespace
WHERE nspname IN ('public', 'drizzle') \gexec
GRANT CONNECT, CREATE ON DATABASE control_plane TO control_plane_migrator;
GRANT CONNECT ON DATABASE control_plane TO control_plane_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO control_plane_migrator;
GRANT USAGE ON SCHEMA public TO control_plane_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO control_plane_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO control_plane_app;
ALTER DEFAULT PRIVILEGES FOR ROLE control_plane_migrator IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM control_plane_app;
ALTER DEFAULT PRIVILEGES FOR ROLE control_plane_migrator IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM control_plane_app;
ALTER DEFAULT PRIVILEGES FOR ROLE control_plane_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO control_plane_app;
ALTER DEFAULT PRIVILEGES FOR ROLE control_plane_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO control_plane_app;
SQL
