import { Migration } from '../migrate';
import { init } from './0001_init';

/** In the order they are applied. Append only. */
export const MIGRATIONS: Migration[] = [init];
