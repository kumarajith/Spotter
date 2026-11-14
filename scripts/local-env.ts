import 'dotenv/config';

// Local development always runs against the in-process PGlite database and
// never talks to AWS, whatever an older .env still contains: no DSQL cluster,
// and no DynamoDB mirror (which is switched on by TABLE_NAME).
delete process.env.DSQL_ENDPOINT;
delete process.env.DATABASE_URL;
delete process.env.TABLE_NAME;
process.env.PGLITE_DIR ??= '.pglite';
