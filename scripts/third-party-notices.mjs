#!/usr/bin/env node
/** Regenerate notices from installed runtime dependencies and resolved Swift sources.
 * Run after app:install and native:build, on the platform being distributed. */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
const json = path => JSON.parse(read(path));
const isNotice = name => /^(?:licen[sc]e|copying|notice|copyright)(?:[.-]|$)/i.test(name);
const entries = [];
for (const [path, row] of Object.entries(json('web/package-lock.json').packages)) {
  if (!path || row.dev) continue;
  const dir = join('web', path);
  if (!existsSync(dir)) continue; // Optional binaries for other platforms aren't distributed.
  const pkg = json(join(dir, 'package.json'));
  let texts = readdirSync(dir, { withFileTypes: true })
    .filter(file => file.isFile() && isNotice(file.name))
    .map(file => ({ file: file.name, text: read(join(dir, file.name)) }));
  if (pkg.name.startsWith('@getpaseo/'))
    texts = [{ file: 'upstream LICENSE (v0.13.2)', text: read('licenses/paseo.txt') }];
  if (!texts.length && pkg.name.startsWith('@esbuild/'))
    texts = [{ file: 'esbuild/LICENSE.md', text: read('web/node_modules/esbuild/LICENSE.md') }];
  if (!texts.length && pkg.name.startsWith('@rollup/'))
    texts = [{ file: 'rollup/LICENSE.md', text: read('web/node_modules/rollup/LICENSE.md') }];
  if (!texts.length) throw new Error(`No license text for ${pkg.name}; resolve before distribution`);
  entries.push({ name: `${pkg.name} ${pkg.version}`, license: row.license ?? 'Apache-2.0 (upstream Paseo)', texts });
}
for (const pin of json('native/Package.resolved').pins) {
  const dir = join('native/.build/checkouts', pin.identity === 'swiftterm' ? 'SwiftTerm' : pin.identity);
  if (!existsSync(dir)) throw new Error(`Build native dependencies first: ${pin.identity}`);
  const texts = readdirSync(dir, { withFileTypes: true })
    .filter(file => file.isFile() && isNotice(file.name))
    .map(file => ({ file: file.name, text: read(join(dir, file.name)) }));
  if (!texts.length) throw new Error(`No license text for ${pin.identity}`);
  entries.push({ name: `${pin.identity} ${pin.state.version}`, license: pin.identity === 'swiftterm' ? 'MIT' : 'Apache-2.0', texts });
}
for (const file of readdirSync('web/src/themes/fonts').filter(file => file.endsWith('-OFL.txt')))
  entries.push({ name: basename(file, '-OFL.txt'), license: 'OFL-1.1', texts: [{ file, text: read(join('web/src/themes/fonts', file)) }] });
// The Node runtime bundled in the app (native/node-version.json).
entries.push({ name: `node ${json('native/node-version.json').version}`, license: 'MIT', texts: [{ file: 'LICENSE', text: read('licenses/node.txt') }] });

entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
const header = `# Third-party notices

These components keep their own licenses. The project's MIT license does not
replace them. This inventory includes installed web runtime dependencies, resolved
Swift packages, the bundled Node runtime, and bundled fonts for this build platform. Optional binaries for
other platforms and development-only packages are not bundled in this inventory;
their distributions supply their own notices.

Regenerate with \`node scripts/third-party-notices.mjs\` after installing dependencies
and building the native target. Paseo's npm packages omit license metadata; the
Apache-2.0 license is retained from the matching upstream v0.13.2 release:
https://github.com/getpaseo/paseo/blob/v0.13.2/LICENSE (also \`licenses/paseo.txt\`).

The app uses provider names and marks to identify integrations. These remain the
property of their owners; no endorsement or trademark permission is implied.
Provider SVGs in \`web/src/providerLogos.ts\` were adapted from the Paseo app
bundle and retain its Apache-2.0 license (\`licenses/paseo.txt\`).
\n`;
writeFileSync('THIRD_PARTY_NOTICES.md', header + entries.map(entry =>
  `## ${entry.name}\n\nLicense: ${entry.license}\n\n` + entry.texts.map(({ file, text }) =>
    `### ${file}\n\n\`\`\`text\n${text}\n\`\`\`\n`).join('\n'),
).join('\n'));
console.log(`Wrote notices for ${entries.length} components.`);
