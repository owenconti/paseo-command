// Linear's pages and the desktop app's addresses for them: `linear://` and the rest of the address.
func app(_ text: String) -> String? { LinearLink.appURL(for: URL(string: text)!)?.absoluteString }
assert(app("https://linear.app/acme/issue/DE-42") == "linear://acme/issue/DE-42")
assert(app("https://linear.app/acme/issue/de-42/fix-the-thing") == "linear://acme/issue/de-42/fix-the-thing")
assert(app("https://linear.app/acme/issue/ENG-1#comment-1a2b") == "linear://acme/issue/ENG-1#comment-1a2b")
assert(app("https://linear.app/acme/issue/ENG-1/x?noRedirect=1") == "linear://acme/issue/ENG-1/x?noRedirect=1")
assert(app("http://LINEAR.app/acme/issue/ENG-1") == "linear://acme/issue/ENG-1")
assert(app("https://linear.app/acme/project/launch-3f2a9c") == "linear://acme/project/launch-3f2a9c")
// Not an issue or project page, not Linear's, or not plainly so: no app address (they open as other links do).
for text in ["https://linear.app/acme/issue/notakey", "https://linear.app/acme/issue", "https://linear.app/acme/settings/api",
             "https://linear.app/docs/get-the-app", "https://linear.app/", "https://linear.app.evil.example/acme/issue/DE-1",
             "https://evil.example/acme/issue/DE-1", "https://user:pw@linear.app/acme/issue/DE-1",
             "https://linear.app:8443/acme/issue/DE-1", "https://linear.app/a%20b/issue/DE-1",
             "ftp://linear.app/acme/issue/DE-1", "linear://acme/issue/DE-1", "https://github.com/acme/web/pull/1"] {
    assert(app(text) == nil, text)
}
print("Linear link checks passed.")
