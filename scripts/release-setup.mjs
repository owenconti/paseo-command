#!/usr/bin/env node
/**
 * One-time release setup, run by the maintainer (safe to run again: whatever exists is kept):
 *   1. a "Developer ID Application" certificate in the login keychain (made on developer.apple.com;
 *      this explains how and installs Apple's intermediate certificate if it is missing),
 *   2. a notarytool login in the keychain, under the profile scripts/signing.mjs names,
 *   3. Sparkle's EdDSA key pair (private half in the keychain), whose public half goes into native/Info.plist.
 * With --unsigned (for `npm run release -- <version> --unsigned` before a Developer ID is ready), only step 3.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTARY_PROFILE, developerIdentities, pickIdentity, validIdentities } from './signing.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const infoPlist = join(root, 'native', 'Info.plist');
const sparkleBin = join(root, 'native', '.build', 'artifacts', 'sparkle', 'Sparkle', 'bin');
// Apple's public Developer ID intermediate: without it a downloaded certificate isn't a valid identity.
const INTERMEDIATE = 'https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer';

/** Info.plist text with SUPublicEDKey set to `key`. */
export function withPublicKey(plist, key) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) throw new Error(`Not a base64 public key: ${key}`);
  const pattern = /(<key>SUPublicEDKey<\/key>\s*<string>)[^<]*(<\/string>)/;
  if (!pattern.test(plist)) throw new Error('native/Info.plist has no SUPublicEDKey entry.');
  return plist.replace(pattern, `$1${key}$2`);
}

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options });
const login = () => join(process.env.HOME, 'Library', 'Keychains', 'login.keychain-db');

async function installIntermediate() {
  const dir = mkdtempSync(join(tmpdir(), 'paseo-release-'));
  try {
    const res = await fetch(INTERMEDIATE);
    if (!res.ok) throw new Error(`Downloading Apple's intermediate certificate: HTTP ${res.status}`);
    const cer = join(dir, 'DeveloperIDG2CA.cer');
    writeFileSync(cer, Buffer.from(await res.arrayBuffer()));
    run('security', ['import', cer, '-k', login()]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A valid Developer ID Application identity, or instructions for making one. */
async function ensureIdentity() {
  if (validIdentities().length === 0 && developerIdentities(run('security', ['find-identity', '-p', 'codesigning'])).length > 0) {
    console.log("Your Developer ID certificate is there but not trusted yet: installing Apple's intermediate certificate...");
    await installIntermediate();
  }
  const valid = validIdentities();
  if (valid.length === 0)
    throw new Error(`No "Developer ID Application" certificate in your login keychain. To make one:
  1. Keychain Access → Keychain Access menu → Certificate Assistant → Request a Certificate From a
     Certificate Authority: your email and name, "Saved to disk". (Its private key stays in your keychain.)
  2. https://developer.apple.com/account/resources/certificates/add → "Developer ID Application"
     (G2 Sub-CA) → upload that request → download the .cer.
  3. Double-click the .cer to add it to the login keychain, then run npm run release:setup again.`);
  const identity = pickIdentity(valid);
  console.log(`Signing identity: ${identity.name}`);
  return identity;
}

/** A notarytool login saved in the keychain; asks for it (Apple ID, app-specific password) if missing. */
function ensureNotaryLogin(team) {
  const works = () => spawnSync('xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE], { stdio: 'ignore' }).status === 0;
  if (works()) return console.log(`Notarization login "${NOTARY_PROFILE}" is saved.`);
  console.log(`
Saving your notarization login as "${NOTARY_PROFILE}". notarytool asks for your Apple ID and an
app-specific password: make one at https://account.apple.com → Sign-In and Security → App-Specific Passwords.
`);
  const saved = spawnSync('xcrun', ['notarytool', 'store-credentials', NOTARY_PROFILE, '--team-id', team], { stdio: 'inherit' });
  if (saved.status !== 0 || !works()) throw new Error('The notarization login was not saved. Run npm run release:setup again.');
}

async function main() {
  if (process.argv.includes('--unsigned')) console.log('--unsigned: skipping the Developer ID and the notarization login.');
  else {
    const identity = await ensureIdentity();
    ensureNotaryLogin(identity.team);
  }

  const generateKeys = join(sparkleBin, 'generate_keys');
  try {
    readFileSync(generateKeys);
  } catch {
    throw new Error('Sparkle\'s tools are missing. Run npm run native:build once, then try again.');
  }
  // Creates the key pair if the keychain has none; -p prints the public half either way.
  run(generateKeys, [], { stdio: 'inherit' });
  const publicKey = run(generateKeys, ['-p']).trim();
  writeFileSync(infoPlist, withPublicKey(readFileSync(infoPlist, 'utf8'), publicKey));
  console.log(`SUPublicEDKey is now ${publicKey} in native/Info.plist.`);

  console.log(`
Next:
  1. git add native/Info.plist && git commit -m "Add the Sparkle public key"
  2. git push origin main
  3. npm run release -- <version>`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
