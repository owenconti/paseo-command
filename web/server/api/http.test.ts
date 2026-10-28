import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigin } from "./http";

test("API and WebSocket origins support local, LAN, VPN and hostname access", () => {
  for (const host of [
    "127.0.0.1:4310",
    "localhost:4310",
    "192.168.1.25:4310",
    "100.64.0.8:4310",
    "studio.local:4310",
    "studio.example.net:4310",
    "[::1]:4310",
  ]) {
    assert.equal(allowedOrigin({ headers: { host } }), `http://${host}`);
  }
});

test("origins use URL normalization, including case and default HTTP port", () => {
  assert.equal(
    allowedOrigin({ headers: { host: "STUDIO.local:80" } }),
    "http://studio.local",
  );
});

test("missing, duplicate and malformed Host headers are refused", () => {
  for (const host of [
    undefined,
    ["studio.local", "other.local"],
    "",
    "bad host",
    "host/path",
    "host\\path",
    "user@host",
    "host?query",
    "host#hash",
    "host:99999",
  ]) {
    assert.equal(allowedOrigin({ headers: { host } }), null);
  }
});
