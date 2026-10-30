// Fetches the pinned Node (native/node-version.json) for both Mac architectures, checks each
// tarball against its published SHA-256, and joins the two binaries into one universal `node`.
// Prints the path. The result is cached in native/.cache/node/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const native = fileURLToPath(new URL('..', import.meta.url));
const { version, sha256 } = JSON.parse(readFileSync(join(native, 'node-version.json'), 'utf8'));
const cache = join(native, '.cache/node');
const universal = join(cache, version, 'node');

if (!existsSync(universal)) {
  mkdirSync(join(cache, version), { recursive: true });
  const thin = {};
  for (const arch of ['arm64', 'x64']) {
    const name = `node-v${version}-darwin-${arch}`;
    const tarball = join(cache, `${name}.tar.gz`);
    const digest = () => createHash('sha256').update(readFileSync(tarball)).digest('hex');
    if (!existsSync(tarball) || digest() !== sha256[arch]) {
      const res = await fetch(`https://nodejs.org/dist/v${version}/${name}.tar.gz`);
      if (!res.ok) throw new Error(`Downloading ${name}: HTTP ${res.status}`);
      writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
    }
    if (digest() !== sha256[arch]) {
      rmSync(tarball);
      throw new Error(`${name}.tar.gz does not match the pinned SHA-256; refusing to use it`);
    }
    execFileSync('tar', ['-xzf', tarball, '-C', join(cache, version), `${name}/bin/node`]);
    thin[arch] = join(cache, version, name, 'bin/node');
  }
  const tmp = `${universal}.new`;
  execFileSync('lipo', ['-create', thin.arm64, thin.x64, '-output', tmp]);
  renameSync(tmp, universal);
  for (const arch of Object.keys(thin)) rmSync(join(cache, version, `node-v${version}-darwin-${arch}`), { recursive: true });
}
console.log(universal);
