import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigin } from "./http";

test("API and WebSocket origins support loopback addresses only", () => {
  for (const host of [
    "127.0.0.1:4310",
    "localhost:4310",
    "[::1]:4310",
  ]) {
    assert.equal(allowedOrigin({ headers: { host } }), `http://${host}`);
  }
});

test("origins use URL normalization, including case and default HTTP port", () => {
  assert.equal(
    allowedOrigin({ headers: { host: "LOCALHOST:80" } }),
    "http://localhost",
  );
});

test("network clients, rebinding hostnames and cross-site requests are refused", () => {
  for (const host of [
    "192.168.1.25:4310", "100.64.0.8:4310", "studio.local:4310",
    "studio.example.net:4310", "localhost.evil.example:4310", "[::]:4310",
  ]) assert.equal(allowedOrigin({ headers: { host } }), null);
  for (const remoteAddress of ["192.168.1.25", "100.64.0.8", "::ffff:192.168.1.25"]) {
    assert.equal(allowedOrigin({ headers: { host: "localhost:4310" }, socket: { remoteAddress } }), null);
  }
  for (const remoteAddress of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(allowedOrigin({ headers: { host: "localhost:4310" }, socket: { remoteAddress } }), "http://localhost:4310");
  }
  assert.equal(allowedOrigin({ headers: { host: "localhost:4310", "sec-fetch-site": "cross-site" } }), null);
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
