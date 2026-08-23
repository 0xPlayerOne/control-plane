CREATE ROLE control_plane_migrator LOGIN PASSWORD 'local-migration-only';
CREATE ROLE control_plane_app LOGIN PASSWORD 'local-application-only';
CREATE DATABASE control_plane OWNER control_plane_migrator;
