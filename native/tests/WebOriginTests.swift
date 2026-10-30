let expected = URL(string: "http://127.0.0.1:4310/")!
for path in ["/", "/?agent=sample", "/landing/"] {
    assert(WebOrigin.matches(URL(string: "http://127.0.0.1:4310\(path)"), to: expected))
}
for address in [
    "https://127.0.0.1:4310/", "http://127.0.0.1:4311/", "http://localhost:4310/",
    "http://127.0.0.1.evil.example:4310/", "https://untrusted.example/",
    "file:///tmp/index.html", "about:blank", "javascript:alert(1)",
] {
    assert(!WebOrigin.matches(URL(string: address), to: expected), address)
}
assert(WebOrigin.matches(URL(string: "http://localhost:80/path"), to: URL(string: "http://localhost/")!))
assert(WebOrigin.matches(scheme: "https", host: "app.example", port: 0, to: URL(string: "https://app.example/")!))
assert(!WebOrigin.matches(scheme: "http", host: "app.example", port: 443, to: URL(string: "https://app.example/")!))
assert(!WebOrigin.matches(nil, to: expected))
print("Native origin policy checks passed.")
