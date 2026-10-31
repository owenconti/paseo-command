import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Each test runs as one script: the sources it needs, then the test itself.
const tests = { Music: ["Music"], LegacyState: ['Log', 'LegacyState'], WebOrigin: ['WebOrigin'], ShellEnvironment: ['ShellEnvironment'], ServerManager: ['Log', 'AppFlavor', 'ShellEnvironment', 'OldInstall', 'ServerManager'], OldInstall: ['Log', 'AppFlavor', 'OldInstall'], Updater: ['AppFlavor', 'WebOrigin', 'Updater'] };
for (const [name, sources] of Object.entries(tests)) {
  const input = [...sources.map(s => `../Sources/PaseoCommandNative/${s}.swift`), `../tests/${name}Tests.swift`]
    .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  process.stdout.write(execFileSync('swift', ['-'], { input, encoding: 'utf8' }));
}
