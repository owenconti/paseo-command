// Fetches the pinned Node (native/node-version.json) for Apple silicon, the only Macs the app
// supports, and checks the tarball against its published SHA-256. Prints the path. The result
// is cached in native/.cache/node/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const native = fileURLToPath(new URL('..', import.meta.url));
const { version, sha256 } = JSON.parse(readFileSync(join(native, 'node-version.json'), 'utf8'));
const cache = join(native, '.cache/node');
const node = join(cache, version, 'node-arm64');

if (!existsSync(node)) {
  mkdirSync(join(cache, version), { recursive: true });
  const name = `node-v${version}-darwin-arm64`;
  const tarball = join(cache, `${name}.tar.gz`);
  const digest = () => createHash('sha256').update(readFileSync(tarball)).digest('hex');
  if (!existsSync(tarball) || digest() !== sha256.arm64) {
    const res = await fetch(`https://nodejs.org/dist/v${version}/${name}.tar.gz`);
    if (!res.ok) throw new Error(`Downloading ${name}: HTTP ${res.status}`);
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  }
  if (digest() !== sha256.arm64) {
    rmSync(tarball);
    throw new Error(`${name}.tar.gz does not match the pinned SHA-256; refusing to use it`);
  }
  execFileSync('tar', ['-xzf', tarball, '-C', join(cache, version), `${name}/bin/node`]);
  renameSync(join(cache, version, name, 'bin/node'), node);
  rmSync(join(cache, version, name), { recursive: true });
}
console.log(node);
