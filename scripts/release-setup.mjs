#!/usr/bin/env node
/**
 * One-time release setup, run by the maintainer: a self-signed code-signing identity in the login
 * keychain and Sparkle's EdDSA key pair (private half in the keychain), whose public half goes into
 * native/Info.plist. Safe to run again: whatever already exists is kept.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IDENTITY = 'Paseo Command Release';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const infoPlist = join(root, 'native', 'Info.plist');
const sparkleBin = join(root, 'native', '.build', 'artifacts', 'sparkle', 'Sparkle', 'bin');

/** Info.plist text with SUPublicEDKey set to `key`. */
export function withPublicKey(plist, key) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) throw new Error(`Not a base64 public key: ${key}`);
  const pattern = /(<key>SUPublicEDKey<\/key>\s*<string>)[^<]*(<\/string>)/;
  if (!pattern.test(plist)) throw new Error('native/Info.plist has no SUPublicEDKey entry.');
  return plist.replace(pattern, `$1${key}$2`);
}

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options });

function hasIdentity() {
  return run('security', ['find-identity', '-p', 'codesigning']).includes(`"${IDENTITY}"`);
}

function createIdentity() {
  const dir = mkdtempSync(join(tmpdir(), 'paseo-release-'));
  try {
    const conf = join(dir, 'openssl.cnf');
    writeFileSync(
      conf,
      `[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = ${IDENTITY}
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
`,
    );
    const key = join(dir, 'key.pem');
    const cert = join(dir, 'cert.pem');
    const p12 = join(dir, 'identity.p12');
    const password = randomBytes(18).toString('base64url');
    // macOS's own openssl: its PKCS#12 output is what `security import` reads.
    const openssl = '/usr/bin/openssl';
    // The key on disk is always encrypted (with a throwaway passphrase), so an interrupted run leaves nothing usable.
    run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-days', '3650', '-config', conf, '-keyout', key, '-out', cert, '-passout', `pass:${password}`]);
    run(openssl, ['pkcs12', '-export', '-inkey', key, '-passin', `pass:${password}`, '-in', cert, '-name', IDENTITY, '-out', p12, '-passout', `pass:${password}`]);
    const keychain = join(process.env.HOME, 'Library', 'Keychains', 'login.keychain-db');
    run('security', ['import', p12, '-k', keychain, '-P', password, '-T', '/usr/bin/codesign']);
    // Trusting it for code signing may ask for your login password.
    run('security', ['add-trusted-cert', '-p', 'codeSign', '-k', keychain, cert], { stdio: 'inherit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  if (hasIdentity()) console.log(`Signing identity "${IDENTITY}" already exists.`);
  else {
    console.log(`Creating the signing identity "${IDENTITY}" in your login keychain...`);
    createIdentity();
    if (!hasIdentity()) throw new Error(`"${IDENTITY}" was imported but is not a valid code-signing identity.`);
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
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
