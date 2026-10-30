import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { withPublicKey } from './release-setup.mjs';

const plist = readFileSync(new URL('../native/Info.plist', import.meta.url), 'utf8');

test('the public key goes into SUPublicEDKey and nothing else changes', () => {
  const out = withPublicKey(plist, 'abc123+/=');
  assert.match(out, /<key>SUPublicEDKey<\/key><string>abc123\+\/=<\/string>/);
  assert.equal(withPublicKey(out, 'zzz='), out.replace('abc123+/=', 'zzz='));
  assert.equal(out.length - plist.length, 'abc123+/='.length - (plist.match(/<key>SUPublicEDKey<\/key>\s*<string>([^<]*)/)[1].length));
});

test('a malformed key is refused', () => {
  assert.throws(() => withPublicKey(plist, '<oops>'), /base64/);
});
