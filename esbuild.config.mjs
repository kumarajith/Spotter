import { build } from 'esbuild';

await build({
  entryPoints: ['src/lambda.ts', 'src/handlers/scheduler.ts'],
  outdir: 'dist',
  bundle: true,
  minify: true,
  sourcemap: 'linked',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  treeShaking: true,
  external: ['@aws-sdk/*'],
});

console.log('Build complete → dist/');
