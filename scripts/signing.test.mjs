import assert from 'node:assert/strict';
import { test } from 'node:test';
import { developerIdentities, isNotarized, notaryResult, pickIdentity } from './signing.mjs';

const listing = `  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Example Person (AAAAAAAAAA)"
  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Developer ID Application: Example Person (TEAM123456)"
     2 valid identities found`;

test('only Developer ID Application identities count, with their team', () => {
  assert.deepEqual(developerIdentities(listing), [{ name: 'Developer ID Application: Example Person (TEAM123456)', team: 'TEAM123456' }]);
  assert.deepEqual(developerIdentities('     0 valid identities found'), []);
});

test('the identity is the only one, or the one PASEO_COMMAND_SIGN_IDENTITY names', () => {
  const one = developerIdentities(listing);
  assert.equal(pickIdentity(one, {}).team, 'TEAM123456');
  assert.throws(() => pickIdentity([], {}), /release:setup/);
  const two = [...one, { name: 'Developer ID Application: Other (TEAM654321)', team: 'TEAM654321' }];
  assert.throws(() => pickIdentity(two, {}), /PASEO_COMMAND_SIGN_IDENTITY/);
  assert.equal(pickIdentity(two, { PASEO_COMMAND_SIGN_IDENTITY: two[1].name }).team, 'TEAM654321');
  assert.throws(() => pickIdentity(one, { PASEO_COMMAND_SIGN_IDENTITY: 'Developer ID Application: Nobody (XXXXXXXXXX)' }), /not a valid/);
});

test("notarytool's answer and Gatekeeper's assessment are read", () => {
  assert.deepEqual(notaryResult('{"id":"abc","status":"Accepted","message":"ok"}'), { id: 'abc', status: 'Accepted', accepted: true });
  assert.equal(notaryResult('{"id":"abc","status":"Invalid"}').accepted, false);
  assert.ok(isNotarized('/x/Paseo Command.app: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: Example Person (TEAM123456)'));
  assert.ok(!isNotarized('/x/Paseo Command.app: accepted\nsource=Unnotarized Developer ID'));
  assert.ok(!isNotarized('/x/Paseo Command.app: rejected\nsource=Notarized Developer ID'));
});
