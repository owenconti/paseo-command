# Running Paseo Command in a browser

The macOS app runs its own server (see [README.md](README.md)); this page is for the browser-only
preview served from a checkout, on port 4310 (stop it first if the released app is running, as they share the port).
Run these commands from your own Terminal, in this repository. The preview runs
as a detached process with its output written to a log, so closing Terminal or
archiving an agent does not stop it. It serves the built app and its API.
It does not automatically start again after reboot.

```sh
npm run app:build
npm run app:start
```

The app binds to **127.0.0.1:4310**, accessible on this machine only.
Open http://127.0.0.1:4310. `app:start` prints the local URL, process ID and
log path; `npm run app:status` prints them again. The dev server uses the same
binding. The API and WebSockets reject external Host headers, nonlocal clients
and cross-origin browser requests. The app has no login or network authentication;
do not expose it through a proxy, tunnel, port forward or shared hosting.

When upgrading from an older build that listened on every interface, run `npm run app:restart` to apply the new binding.
Building an update alone does not change a running server.

An existing unmanaged server on the port is left alone; stop it from its original
terminal before switching to this launcher.

## Updating and stopping

After pulling or changing the code, run:

```sh
npm run app:build
```

This rebuilds `web/dist/` without restarting the server, so open pages stay connected; the server
serves each new build as it is. Run `npm run app:refresh` yourself to restart the server only when its own code
(`web/server/`, the Vite config, dependencies or this launcher) changed since it started, then refresh the page.
Restart and refresh preserve the launcher's saved port.
Use `npm run app:stop` to stop this launcher's server.

An alternate port is available with `npm run app:start -- --port 4311` or
`npm run app:restart -- --port 4311`.
