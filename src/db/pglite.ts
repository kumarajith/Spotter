import { PGlite } from '@electric-sql/pglite';
import { Db, Row } from './db';

/**
 * Postgres compiled to WASM, running inside this Node process.
 * Used for tests (in-memory) and the local dev server (a data folder) — never in Lambda.
 */
export class PgliteDb implements Db {
  private readonly pg: PGlite;

  /** @param dataDir folder to persist to; omit for a throwaway in-memory database */
  constructor(dataDir?: string) {
    this.pg = new PGlite(dataDir);
  }

  async query<R extends Row = Row>(text: string, params: unknown[] = []): Promise<R[]> {
    const result = await this.pg.query<R>(text, params);
    return result.rows;
  }

  end(): Promise<void> {
    return this.pg.close();
  }
}
