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
  external: [
    // Provided by the Lambda Node.js runtime. Everything else from the AWS SDK
    // (the DSQL token signer and its credential chain) is bundled, so the
    // functions do not depend on which SDK version the runtime happens to ship.
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
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
