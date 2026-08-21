import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'mobile_www');

const entries = [
  'index.html',
  'chat.html',
  'daily.html',
  'diary.html',
  'changelog.html',
  'notification-guide.html',
  'admin.html',
  'manifest.json',
  'sw.js',
  'assets',
  'tutorials'
];

async function rmSafe(target) {
  await fs.rm(target, { recursive: true, force: true });
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function copyEntry(rel) {
  const src = path.join(root, rel);
  const dst = path.join(outDir, rel);
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.cp(src, dst, { recursive: true, force: true });
  } else {
    await ensureDir(path.dirname(dst));
    await fs.copyFile(src, dst);
  }
}

await rmSafe(outDir);
await ensureDir(outDir);

for (const rel of entries) {
  await copyEntry(rel);
}

console.log('App web bundle ready:', outDir);
