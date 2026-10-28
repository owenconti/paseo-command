# Running Paseo Command independently

Run these commands from your own Terminal, in this repository. The preview runs
as a detached process with its output written to a log, so closing Terminal or
archiving an agent does not stop it. It serves the built app and its local API.
It does not automatically start again after reboot.

```sh
npm run app:build
npm run app:start
```

Open http://127.0.0.1:4310. `app:start` prints the process ID and log path;
`npm run app:status` prints them again. An existing unmanaged server on the port
is left alone; stop it from its original terminal before switching to this launcher.

## Access through Tailscale

With Tailscale installed, connected, and HTTPS/Serve enabled for your tailnet:

```sh
npm run app:start -- --tailscale
```

The launcher discovers this machine's Tailscale DNS name and configures a persistent
Tailscale Serve reverse proxy on HTTPS port **8443**. It prints the exact URL,
for example `https://your-machine.your-tailnet.ts.net:8443`. The app itself stays
on `127.0.0.1:4310`; its API, WebSocket, and Vite host checks allow that exact
Tailscale hostname. Access follows your tailnet's permissions.

The launcher refuses to replace another service on Tailscale port 8443 or use an
endpoint with Funnel enabled. It does not enable Funnel or publish the project.
The regular port 443 remains available for other apps.

If the app is already running locally, switch it with:

```sh
npm run app:restart -- --tailscale
```

For an existing proxy you manage yourself, instead set
`PASEO_COMMAND_TAILNET_HOST=your-machine.your-tailnet.ts.net` when starting the app.
`PASEO_COMMAND_TAILSCALE_BIN` can select a particular Tailscale executable.

[Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve)

## Updating and stopping

Agents can rebuild the UI while the independent server keeps running:

```sh
npm run app:build
```

Refresh the browser after a rebuild. After server/API or Vite configuration
changes, restart the server too:

```sh
npm run app:restart
```

Restart preserves the launcher's saved port and Tailscale settings. Use
`npm run app:stop` to stop this launcher's server. The Tailscale Serve mapping
remains configured so the next start can reuse it. To remove that mapping too:

```sh
tailscale serve --https=8443 off
```

An alternate local port is available with `npm run app:start -- --port 4311`.
