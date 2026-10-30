import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

for (const name of ['WebOrigin', 'ShellEnvironment']) {
  const input = [`../Sources/PaseoCommandNative/${name}.swift`, `../tests/${name}Tests.swift`]
    .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  process.stdout.write(execFileSync('swift', ['-'], { input, encoding: 'utf8' }));
}
