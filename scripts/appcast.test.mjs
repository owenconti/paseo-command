import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appcastXML } from './appcast.mjs';

const item = {
  version: '0.2.0',
  build: '123',
  date: new Date('2026-10-30T12:00:00Z'),
  url: 'https://github.com/owenconti/paseo-command/releases/download/v0.2.0/Paseo-Command-0.2.0.zip',
  length: 4242,
  edSignature: 'c2lnbmF0dXJl==',
  notesHTML: '<ul><li>Fish & chips</li></ul>',
  minimumSystemVersion: '14.0',
};

/** Every opening tag has its closing tag, in order (a cheap well-formedness check without an XML dependency). */
function assertBalanced(xml) {
  const stack = [];
  const body = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  for (const [, close, name, selfClose] of body.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (selfClose) continue;
    if (!close) stack.push(name);
    else assert.equal(stack.pop(), name, `unbalanced </${name}>`);
  }
  assert.deepEqual(stack, []);
}

test('appcast has the enclosure, versions, signature and notes', () => {
  const xml = appcastXML(item);
  assertBalanced(xml);
  assert.match(xml, /<enclosure url="https:\/\/github\.com\/owenconti\/paseo-command\/releases\/download\/v0\.2\.0\/Paseo-Command-0\.2\.0\.zip"/);
  assert.match(xml, /length="4242"/);
  assert.match(xml, /sparkle:edSignature="c2lnbmF0dXJl=="/);
  assert.match(xml, /sparkle:shortVersionString="0\.2\.0"/);
  assert.match(xml, /sparkle:version="123"/);
  assert.match(xml, /<sparkle:minimumSystemVersion>14\.0<\/sparkle:minimumSystemVersion>/);
  assert.match(xml, /<pubDate>Fri, 30 Oct 2026 12:00:00 \+0000<\/pubDate>/);
  assert.ok(xml.includes('<![CDATA[<ul><li>Fish & chips</li></ul>]]>'));
});

test('appcast escapes ampersands in titles', () => {
  const xml = appcastXML({ ...item, title: 'Fish & Chips <1>' });
  assert.ok(xml.includes('<title>Fish &amp; Chips &lt;1&gt;</title>'));
  assertBalanced(xml);
});

test('notes containing a CDATA terminator stay inside the CDATA', () => {
  const xml = appcastXML({ ...item, notesHTML: 'a ]]> b' });
  assert.ok(!xml.includes('a ]]> b'));
  assertBalanced(xml);
});
