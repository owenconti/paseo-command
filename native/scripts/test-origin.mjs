import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const input = ['../Sources/PaseoCommandNative/WebOrigin.swift', '../tests/WebOriginTests.swift']
  .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
process.stdout.write(execFileSync('swift', ['-'], { input, encoding: 'utf8' }));
