# Running Paseo Command independently

Run these commands from your own Terminal, in this repository. The preview runs
as a detached process with its output written to a log, so closing Terminal or
archiving an agent does not stop it. It serves the built app and its API.
It does not automatically start again after reboot.

```sh
npm run app:build
npm run app:start
```

The app always binds to **0.0.0.0:4310**, listening on every IPv4 network interface.
Open http://127.0.0.1:4310 on this machine, or `http://<host-IP-or-hostname>:4310`
from another device. `app:start` prints local and network URLs, the process ID, and
the log path; `npm run app:status` prints them again. The dev server uses the same
binding. API and WebSocket requests support the host's network addresses and keep
same-origin browser checks.

An existing unmanaged server on the port is left alone; stop it from its original
terminal before switching to this launcher.

## Updating and stopping

After finishing a feature, commit and merge it into local `main`, then run from
the main checkout:

```sh
npm run app:build && npm run app:restart
```

Refresh the browser after the rebuild. Restart preserves the launcher's saved port.
Use `npm run app:stop` to stop this launcher's server.

An alternate port is available with `npm run app:start -- --port 4311` or
`npm run app:restart -- --port 4311`.
