import { build } from 'esbuild';

const result = await build({
  entryPoints: ['src/lambda.ts', 'src/handlers/scheduler.ts', 'src/handlers/data-ops.ts'],
  outdir: 'dist',
  bundle: true,
  minify: true,
  sourcemap: 'linked',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  treeShaking: true,
  metafile: true,
  // Everything the functions need is bundled, including the AWS SDK pieces that
  // sign DSQL auth tokens, so they do not depend on which SDK version the Lambda
  // runtime happens to ship.
  external: [
    // Optional native bindings that `pg` only loads on request.
    'pg-native',
    // Local-dev/test database; reached only when PGLITE_DIR is set.
    '@electric-sql/pglite',
  ],
});

for (const [file, { bytes }] of Object.entries(result.metafile.outputs)) {
  if (file.endsWith('.js')) console.log(`${file}  ${(bytes / 1024).toFixed(0)} KB`);
}
console.log('Build complete → dist/');
