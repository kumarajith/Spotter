import 'dotenv/config';

// Local development always runs against the in-process PGlite database and
// never talks to AWS, whatever an older .env still contains.
delete process.env.DSQL_ENDPOINT;
delete process.env.DATABASE_URL;
delete process.env.TABLE_NAME;
process.env.PGLITE_DIR ??= '.pglite';
