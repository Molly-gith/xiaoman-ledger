-- Cron runtime only. Named salary jobs are activated separately after a
-- synthetic owner-scoped scheduler run and the deployed UI have been verified.
-- Use the project's default extension version; do not alter global time zone.
create extension if not exists pg_cron;
