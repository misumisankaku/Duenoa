import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(projectRoot, 'dist');
const files = ['index.html', 'metrics.html', 'ads.txt', 'og-image.jpg', '_routes.json'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  await copyFile(resolve(projectRoot, file), resolve(output, file));
}
await cp(resolve(projectRoot, 'assets'), resolve(output, 'assets'), { recursive: true });
