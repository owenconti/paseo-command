#!/usr/bin/env node
/**
 * Release signing and notarization, shared by bundle.sh, release.mjs and release-setup.mjs: which
 * Developer ID to sign with, the notarytool keychain profile, and reading Apple's answers.
 *   node scripts/signing.mjs identity   prints the identity bundle.sh --release signs with
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The keychain profile `xcrun notarytool store-credentials` saves the Apple ID login under. */
export const NOTARY_PROFILE = 'paseo-command-notary';

/** Developer ID Application identities in `security find-identity` output, with their team ids. */
export function developerIdentities(text) {
  return [...text.matchAll(/"(Developer ID Application: [^"]+ \(([A-Z0-9]{10})\))"/g)]
    .map((m) => ({ name: m[1], team: m[2] }))
    .filter((id, i, all) => all.findIndex((other) => other.name === id.name) === i);
}

/** The one identity to sign with: `PASEO_COMMAND_SIGN_IDENTITY` if set, else the only valid one. */
export function pickIdentity(valid, env = process.env) {
  if (env.PASEO_COMMAND_SIGN_IDENTITY) {
    const chosen = valid.find((id) => id.name === env.PASEO_COMMAND_SIGN_IDENTITY);
    if (!chosen) throw new Error(`PASEO_COMMAND_SIGN_IDENTITY "${env.PASEO_COMMAND_SIGN_IDENTITY}" is not a valid signing identity in the keychain.`);
    return chosen;
  }
  if (valid.length === 0) throw new Error('No valid "Developer ID Application" signing identity in the keychain. Run npm run release:setup first.');
  if (valid.length > 1)
    throw new Error(`More than one Developer ID Application identity; set PASEO_COMMAND_SIGN_IDENTITY to one of:\n  ${valid.map((id) => id.name).join('\n  ')}`);
  return valid[0];
}

export const validIdentities = () => developerIdentities(execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }));

/** notarytool's `--output-format json` answer to `submit --wait`. */
export function notaryResult(json) {
  const answer = JSON.parse(json);
  return { id: answer.id, status: answer.status, accepted: answer.status === 'Accepted' };
}

/** Whether `spctl --assess -vv` says Gatekeeper accepts the app as notarized. */
export const isNotarized = (assessment) => /accepted/.test(assessment) && /source=Notarized Developer ID/.test(assessment);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv[2] !== 'identity') throw new Error('usage: node scripts/signing.mjs identity');
    console.log(pickIdentity(validIdentities()).name);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
