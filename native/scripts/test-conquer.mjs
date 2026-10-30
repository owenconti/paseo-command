import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const sources = ['AppFlavor', 'Geometry', 'Textures', 'NativeTheme', 'ChromeControls', 'PageBar',
  'ConquerTabs', 'ConquerExtras', 'ZenCookies', 'Conquer'];
const input = [...sources.map(name => readFileSync(new URL(`../Sources/PaseoCommandNative/${name}.swift`, import.meta.url), 'utf8')),
  readFileSync(new URL('../tests/ConquerTabsTests.swift', import.meta.url), 'utf8')].join('\n');
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<title>Conquer test page</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const child = spawn('swift', ['-', `http://127.0.0.1:${server.address().port}/`], { stdio: ['pipe', 'inherit', 'inherit'] });
  child.stdin.end(input);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (code !== 0) process.exitCode = code || 1;
} finally {
  server.closeAllConnections();
  server.close();
}
