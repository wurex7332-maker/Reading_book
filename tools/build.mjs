import { copyFile, mkdir } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });

for (const file of ['index.html', 'styles.css', 'main.js', 'reader.js', 'storage.js']) {
  await copyFile(new URL(`../src/${file}`, import.meta.url), new URL(file, output));
}
