import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  logLevel: 'info',
};

const entries = [
  { entry: 'src/background/service-worker.js', outfile: 'extension/dist/service-worker.js' },
  { entry: 'src/sidepanel/sidepanel.js', outfile: 'extension/dist/sidepanel.js' },
  { entry: 'src/content/picker.js', outfile: 'extension/dist/picker.js' },
];

if (watch) {
  const contexts = await Promise.all(
    entries.map((e) => esbuild.context({ ...commonOptions, entryPoints: [e.entry], outfile: e.outfile })),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('Watching for changes... (Ctrl+C to stop)');
} else {
  await Promise.all(
    entries.map((e) => esbuild.build({ ...commonOptions, entryPoints: [e.entry], outfile: e.outfile })),
  );
  console.log('Build complete.');
}
