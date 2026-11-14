import './local-env';
import { createDb } from '../src/db/db';
import { runMigrations } from '../src/db/migrate';

async function main() {
  const db = createDb();
  try {
    const applied = await runMigrations(db);
    console.log(
      applied.length
        ? `Local database (${process.env.PGLITE_DIR}): applied ${applied.join(', ')}`
        : `Local database (${process.env.PGLITE_DIR}) is up to date`,
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
