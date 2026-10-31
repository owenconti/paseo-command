# Security

Paseo Command is a local desktop application for a trusted single-user machine.
It is not a multiuser service or a remote administration endpoint.

The web server binds to `127.0.0.1`. API requests and terminal WebSocket upgrades
also require a loopback Host, a local peer and, when present, a matching Origin.
Cross-site browser requests are rejected. These controls restrict network access;
they do not isolate other processes or users on the same machine. The server can
read agent conversations and direct agents and terminals with your permissions.

Do not expose the app through a proxy, tunnel, port forward or public hosting.
Keep your operating system, Node.js, Paseo and dependencies updated. Treat agent
output, attachments and external links as untrusted content. Conquer is an
experimental browser, with a local cookie store and optional external sites; its
Zen session-import behavior is described in the README.

Keys belong in environment variables or local secret files, never Git. In
particular, question detection sends candidate reply sentences to TypeSafe when
configured, and helper agents send their input to the configured provider.

## Reporting

Use GitHub's private vulnerability reporting on this repository when available.
If it is unavailable, contact the maintainer privately before publishing details.
Never post credentials, personal data or exploit details in a public issue.

## Preventing publication leaks

Run `npm run public:check` before committing. It inspects tracked files, not your
ignored local archives or browser data. `npm run public:check -- --history` also
checks the history reachable from HEAD. `npm run secrets:scan` runs Gitleaks for credential
patterns (also part of `npm run check` and `npm run release`; there is no CI);
neither check guarantees that all private information has been found. Review
screenshots, fixtures and new integrations for privacy and ownership as well.

The public repository was prepared from sanitized history. Old local branches and
worktrees may still contain private data. Never merge their original history into
the publication branch, push old tags, or use `git push --all` or `--mirror`.
Move needed changes by reviewing and cherry-picking individual commits onto the
new main, or rebase a verified range onto it. Scan the resulting history again.
Keep recovery bundles and the original repository private.

Install the local shared Git push guard with `npm run public:hooks`. It checks the
exact commit being pushed, including pushes from linked worktrees. It refuses
other branches and tags, and commits whose ancestry contains excluded private
files or personal home paths. This supplements, rather than replaces, secret
scanning and review.
