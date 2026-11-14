import 'dotenv/config';

// Local development always runs against the in-process PGlite database and
// never talks to AWS, whatever the .env contains.
delete process.env.DSQL_ENDPOINT;
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR ??= '.pglite';
