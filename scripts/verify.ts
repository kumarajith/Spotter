/**
 * Cutover sanity check: invokes the deployed `verify` Lambda and prints its report.
 *
 *   npm run verify -- --env dev
 *   npm run verify -- --env prod
 *
 * The app stops writing to DynamoDB at the switch, so the table is a frozen
 * record of everything up to then. The Lambda re-copies DynamoDB -> DSQL, checks
 * that nothing DynamoDB holds is missing from DSQL, and lists users whose
 * derived streak differs from the one stored before v4.
 * Needs the AWS CLI with credentials that may invoke the function.
 * Exits 1 when something is missing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RowCheck, VerifyReport } from '../src/legacy/verify';

const REGION = 'ap-south-1';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function invoke(functionName: string): unknown {
  const dir = mkdtempSync(path.join(tmpdir(), 'spotter-verify-'));
  const outFile = path.join(dir, 'report.json');
  try {
    const meta = JSON.parse(
      execFileSync(
        'aws',
        [
          'lambda',
          'invoke',
          '--function-name',
          functionName,
          '--region',
          REGION,
          '--cli-read-timeout',
          '0',
          '--output',
          'json',
          outFile,
        ],
        { encoding: 'utf8' },
      ),
    ) as { FunctionError?: string };
    const payload = JSON.parse(readFileSync(outFile, 'utf8')) as unknown;
    if (meta.FunctionError) {
      throw new Error(`${functionName} failed: ${JSON.stringify(payload, null, 2)}`);
    }
    return payload;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printRows(label: string, row: RowCheck): void {
  console.log(
    `  ${label.padEnd(12)}${String(row.dynamo).padStart(9)}${String(row.sql).padStart(9)}` +
      `${String(row.missingFromSqlCount).padStart(19)}${String(row.newInSqlCount).padStart(22)}`,
  );
}

function printKeys(title: string, keys: string[], total: number): void {
  if (total === 0) return;
  console.log(`\n  ${title} (${total}):`);
  for (const key of keys) console.log(`    ${key}`);
  if (total > keys.length) console.log(`    … and ${total - keys.length} more`);
}

function main(): void {
  const env = argument('--env');
  if (env !== 'dev' && env !== 'prod') {
    console.error('Usage: npm run verify -- --env dev|prod');
    process.exit(2);
  }

  console.log(`Invoking spotter-${env}-verify …`);
  const report = invoke(`spotter-${env}-verify`) as VerifyReport;
  const { copy, rows, streaks } = report;

  console.log(`\nSpotter ${env} — as of ${report.today} (UTC)\n`);

  console.log('Copied from DynamoDB in this run (0 everywhere means nothing was missing):');
  console.log(
    `  ${copy.inserted.logs} logs, ${copy.inserted.activities} activities, ` +
      `${copy.inserted.channels} channels, ${copy.inserted.bestStreakFloors} best-streak floors`,
  );

  console.log('\nRows                DynamoDB     DSQL  missing from DSQL  new since the switch');
  printRows('logs', rows.logs);
  printRows('activities', rows.activities);
  printRows('channels', rows.channels);

  for (const [name, row] of Object.entries(rows)) {
    printKeys(`${name} in DynamoDB but not in DSQL`, row.missingFromSql, row.missingFromSqlCount);
  }
  printKeys(
    'Logs with a date that is not a real day',
    copy.invalidDateLogs,
    copy.invalidDateLogs.length,
  );
  printKeys(
    'DynamoDB items the copy does not understand',
    copy.unrecognised,
    copy.unrecognised.length,
  );

  console.log(
    `\nStreaks: ${streaks.compared} users compared, ${streaks.differences.length} differ` +
      ' (stored before v4 → derived from logs now)',
  );
  for (const d of streaks.differences) {
    console.log(
      `  guild ${d.guildId}  user ${d.userId}  ` +
        `current ${d.stored.current} → ${d.derived.current}   best ${d.stored.best} → ${d.derived.best}`,
    );
  }

  if (report.ok) {
    console.log('\nRESULT: everything DynamoDB holds is in DSQL.');
  } else {
    console.log('\nRESULT: DynamoDB holds data that is not in DSQL — see the lists above.');
    process.exit(1);
  }
}

main();
