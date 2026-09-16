-- Runs once, when the pgdata volume is first initialised.
-- A disposable database for the integration suite (DATABASE_URL_TEST).
CREATE DATABASE ams_test OWNER ams;
