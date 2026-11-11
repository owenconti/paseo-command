// The board's browser, as agents' browser tools use it: which addresses open, the keys they name, and
// the page script (snapshot, click, fill, type, keys, select, upload) on a page of its own in a web view.
// Runs in an isolated accessory process with nonpersistent storage; nothing is loaded from anywhere.
import AppKit
import WebKit

_ = NSApplication.shared
NSApp.setActivationPolicy(.accessory)

// Addresses: this Mac's own, however written, are refused to agents on other hosts.
for address in ["http://localhost:3000/", "http://LOCALHOST/", "http://127.0.0.1/", "http://127.8.9.1:80/x", "http://2130706433/", "http://0x7f.1/",
                "http://0177.0.0.1/", "http://[::1]:8080/", "http://[::ffff:127.0.0.1]/", "http://app.localhost/", "http://0.0.0.0:4321/", "http://localhost./"] {
    let url = URL(string: address)!
    assert(BrowserPolicy.isLoopback(url), address)
    assert(BrowserPolicy.refusal(url, host: "srv_remote") != nil, address)
    assert(BrowserPolicy.refusal(url, host: "local") == nil, address)
}
for address in ["https://example.com/", "http://10.0.0.5:3000/", "http://192.168.1.4/", "http://localhost.example.com/", "http://128.0.0.1/", "http://[2001:db8::1]/"] {
    let url = URL(string: address)!
    assert(!BrowserPolicy.isLoopback(url), address)
    assert(BrowserPolicy.refusal(url, host: "srv_remote") == nil, address)
}
for address in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "ftp://example.com/", "about:blank"] {
    assert(BrowserPolicy.refusal(URL(string: address)!, host: "local") != nil, address)
}
assert((try? JSONSerialization.jsonObject(with: Data(BrowserPolicy.loopbackRules.utf8)) as? [[String: Any]])?.count == 6)
assert(BrowserPolicy.destination("localhost:3000")?.absoluteString == "http://localhost:3000")
assert(BrowserPolicy.destination("192.168.1.4:8080/x")?.absoluteString == "http://192.168.1.4:8080/x")
assert(BrowserPolicy.destination("example.com/docs")?.absoluteString == "https://example.com/docs")
assert(BrowserPolicy.destination(" https://a.example/b ")?.absoluteString == "https://a.example/b")
for typed in ["", "two words", "ftp://example.com", "javascript:alert(1)"] { assert(BrowserPolicy.destination(typed) == nil, typed) }

// Keys.
assert(BrowserKey("Enter") == BrowserKey("return"))
assert(BrowserKey("Control+Shift+K").map { [$0.key] + $0.modifiers } == ["K", "Control", "Shift"])
assert(BrowserKey("cmd+a").map { [$0.key] + $0.modifiers } == ["a", "Meta"])
assert(BrowserKey("Shift++")?.key == "+" && BrowserKey("+")?.key == "+" && BrowserKey("space")?.key == " " && BrowserKey("F5")?.key == "F5")
for bad in ["", "Bogus+x", "Hello", "Control+"] { assert(BrowserKey(bad) == nil, bad) }

// Requests and answers.
let asked = BrowserRequest(["type": "request", "host": "local", "request": [
    "requestId": "browser_1", "agentId": "agt_1", "workspaceId": "wks_1", "cwd": "/code",
    "command": ["command": "click", "args": ["browserId": "0f8b3c1e-52a7-4c9d-9b1e-2f6a7d8c9e10", "ref": "@e2"]]]])!
assert(asked.command == "click" && asked.agent == "agt_1" && asked.tab == "0f8b3c1e-52a7-4c9d-9b1e-2f6a7d8c9e10" && asked.string("ref") == "@e2")
assert(BrowserRequest(["host": "local", "request": ["requestId": "x", "command": ["command": "format_disk"]]]) == nil)
assert(BrowserRequest(["request": ["requestId": "x", "command": ["command": "click"]]]) == nil)
let ok = asked.done(["browserId": "b", "ref": "@e2"])["payload"] as! [String: Any]
assert(ok["ok"] as? Bool == true && (ok["result"] as? [String: Any])?["command"] as? String == "click" && ok["requestId"] as? String == "browser_1")
let no = asked.failed(BrowserFailure("made_up", ""), dialogs: [["type": "alert"]])["payload"] as! [String: Any]
assert((no["error"] as? [String: Any])?["code"] as? String == "browser_unknown_error" && (no["dialogs"] as? [[String: Any]])?.count == 1)
assert(BrowserRequest.commands.count == 22)

// The page script, on a page.
let html = """
<!doctype html><html><head><title>Sign up</title><style>.gone{display:none}.card{cursor:pointer}</style></head><body>
<header><nav aria-label="Main"><a href="https://example.com/docs">Docs</a> <a href="#pricing"><img alt="Pricing" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a></nav></header>
<main>
  <h1>Create your <a href="#account">account</a></h1>
  <p>It takes <b>one</b> minute.</p>
  <form id="f">
    <label for="email">Email</label><input id="email" type="email" required>
    <label>Password <input id="pw" type="password" value="hunter2"></label>
    <label><input id="terms" type="checkbox"> I agree</label>
    <label for="plan">Plan</label><select id="plan"><option value="free">Free</option><option value="pro">Pro plan</option></select>
    <textarea id="notes" aria-label="Notes"></textarea>
    <input id="avatar" type="file" aria-label="Avatar">
    <button id="go" type="submit">Sign up</button>
    <button disabled>Later</button>
  </form>
  <div id="card" class="card">Open the <span>welcome</span> card</div>
  <div id="edit" contenteditable="true" aria-label="Bio">Hello</div>
  <ul><li>First</li><li>Second <button id="more" aria-expanded="false">More</button></li></ul>
  <div class="gone"><button>Hidden</button></div><div aria-hidden="true"><button>Hidden too</button></div>
  <script>
    window.seen = [];
    document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); window.seen.push('submit'); });
    document.getElementById('card').addEventListener('click', () => window.seen.push('card'));
    document.getElementById('more').addEventListener('click', (e) => { e.target.setAttribute('aria-expanded', 'true'); window.seen.push('more'); });
    for (const id of ['email', 'notes', 'plan', 'terms', 'avatar']) for (const type of ['input', 'change'])
      document.getElementById(id).addEventListener(type, () => window.seen.push(id + ':' + type));
    document.getElementById('email').addEventListener('keydown', (e) => window.seen.push('key:' + e.key + ':' + e.keyCode + (e.ctrlKey ? ':ctrl' : '')));
  </script>
</main></body></html>
"""
let configuration = WKWebViewConfiguration()
configuration.websiteDataStore = .nonPersistent()
let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 900, height: 700), configuration: configuration)
final class Loaded: NSObject, WKNavigationDelegate {
    var done = false
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { done = true }
}
let loaded = Loaded()
web.navigationDelegate = loaded
web.loadHTMLString(html, baseURL: URL(string: "https://app.example/signup"))
func spin(_ what: String, until done: () -> Bool) {
    let deadline = Date().addingTimeInterval(20)
    while !done() {
        guard Date() < deadline else { fatalError("timed out: \(what)") }
        RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.01))
    }
}
spin("the page") { loaded.done }

/// One action of the page script: its value, or its failure's code.
func run(_ name: String, _ args: [String: Any] = [:]) -> (value: [String: Any], code: String?, message: String) {
    var result: Result<Any, Error>?
    web.callAsyncJavaScript(BrowserScript.call(name), arguments: ["args": args], in: nil, in: .page) { result = $0 }
    spin(name) { result != nil }
    guard case .success(let raw)? = result, let answer = raw as? [String: Any] else { fatalError("\(name): \(String(describing: result))") }
    if answer["ok"] as? Bool == true { return (answer["value"] as? [String: Any] ?? ["value": answer["value"] as Any], nil, "") }
    return ([:], answer["code"] as? String, answer["message"] as? String ?? "")
}
func js(_ source: String) -> Any? {
    var result: Result<Any, Error>?
    web.callAsyncJavaScript("return \(source)", arguments: [:], in: nil, in: .page) { result = $0 }
    spin(source) { result != nil }
    if case .success(let value)? = result { return value }
    fatalError("\(source): \(String(describing: result))")
}

var shot = run("snapshot").value
let text = shot["snapshot"] as! String
let lines = text.components(separatedBy: "\n")
func ref(_ needle: String) -> String {
    guard let line = lines.first(where: { $0.contains(needle) && $0.contains("ref=") }), let found = line.range(of: "ref=@e[0-9]+", options: .regularExpression) else { fatalError("no ref for \(needle) in\n\(text)") }
    return String(line[found].dropFirst(4))
}
assert(shot["url"] as? String == "https://app.example/signup" && shot["title"] as? String == "Sign up" && shot["truncated"] as? Bool == false)
for expected in [
    "- banner", "  - navigation \"Main\"", "- link \"Docs\" [ref=@e1]", "- /url: \"https://example.com/docs\"", "- link \"Pricing\" [ref=@e2]",
    "- heading \"Create your account\" [level=1]", "- link \"account\" [ref=@e3]", "- paragraph: \"It takes one minute.\"",
    "- textbox \"Email\" [required ref=@e4]", "- textbox \"Password\" [value=\"••••\" ref=@e5]", "- checkbox \"I agree\" [ref=@e6]",
    "- combobox \"Plan\" [value=\"Free\" ref=@e7]", "- option \"Free\" [selected]", "- option \"Pro plan\"", "- textbox \"Notes\" [ref=@e8]",
    "- button \"Avatar\" [type=file ref=@e9]", "- button \"Sign up\" [ref=@e10]", "- button \"Later\" [disabled ref=@e11]",
    "- generic [ref=@e12]: \"Open the welcome card\"", "- textbox \"Bio\" [value=\"Hello\" ref=@e13]", "- listitem: \"First\"",
    "- button \"More\" [expanded=false ref=@e14]",
] {
    assert(lines.contains { $0.trimmingCharacters(in: .whitespaces) == expected.trimmingCharacters(in: .whitespaces) }, "missing \(expected) in\n\(text)")
}
assert(!text.contains("Hidden") && !text.contains("hunter2") && !text.contains("window.seen"), text)
let stats = shot["stats"] as! [String: Any]
assert(stats["refCount"] as? Int == 14 && (stats["nodeCount"] as? Int ?? 0) > 20 && stats["iframeCount"] as? Int == 0)

// Fill a field, as a person's typing reaches the page: input and change.
assert(run("fill", ["ref": ref("\"Email\""), "value": "a@b.co"]).code == nil)
assert(js("document.getElementById('email').value") as? String == "a@b.co")
assert(js("window.seen.join(',')") as? String == "email:input,email:change")
// A checkbox takes true or false; a select a value or a label.
assert(run("fill", ["ref": ref("I agree"), "value": "true"]).code == nil && js("document.getElementById('terms').checked") as? Bool == true)
assert(run("select", ["ref": ref("\"Plan\""), "value": "Pro plan"]).value["value"] as? String == "pro")
assert(js("document.getElementById('plan').value") as? String == "pro")
let none = run("select", ["ref": ref("\"Plan\""), "value": "Team"])
assert(none.code == "browser_unknown_error" && none.message.contains("\"Pro plan\""), none.message)
// Typing goes key by key, into a field, an editable element, or whatever has the keyboard.
_ = js("(window.seen = [], 0)")
assert(run("type", ["ref": ref("\"Notes\""), "text": "Hi\nthere"]).code == nil)
assert(js("document.getElementById('notes').value") as? String == "Hi\nthere")
assert(run("type", ["text": "!"]).code == nil && js("document.getElementById('notes').value") as? String == "Hi\nthere!")
assert(run("type", ["ref": ref("\"Bio\""), "text": " you"]).code == nil)
assert((js("document.getElementById('edit').textContent") as? String)?.replacingOccurrences(of: "\u{a0}", with: " ") == "Hello you")
// Keys: their names and codes as a page reads them; Backspace erases; the caret moves; Enter in a field submits its form.
_ = js("(window.seen = [], 0)")
assert(run("keypress", ["ref": ref("\"Email\""), "key": "x", "modifiers": ["Control"]]).code == nil)
assert(run("keypress", ["key": "x", "modifiers": []]).code == nil && js("document.getElementById('email').value") as? String == "a@b.cox")
assert(run("keypress", ["key": "Backspace", "modifiers": []]).code == nil && js("document.getElementById('email').value") as? String == "a@b.co")
assert(run("keypress", ["key": "Enter", "modifiers": []]).code == nil)
let seen = js("window.seen.join(',')") as! String
assert(seen.contains("key:x:88:ctrl") && seen.contains("key:Backspace:8") && seen.contains("key:Enter:13") && seen.hasSuffix("submit"), seen)
assert(run("keypress", ["ref": ref("\"Notes\""), "key": "Home", "modifiers": []]).code == nil && run("type", ["text": "> "]).code == nil)
assert(js("document.getElementById('notes').value") as? String == "> Hi\nthere!")
assert(run("keypress", ["key": "a", "modifiers": ["Meta"]]).code == nil && run("keypress", ["key": "Delete", "modifiers": []]).code == nil)
assert(js("document.getElementById('notes').value") as? String == "")
// Clicks: a button (its form submits), a plain element with a click handler, a disabled one refused.
_ = js("(window.seen = [], 0)")
let clicked = run("click", ["ref": ref("\"Sign up\"")])
// (The field left behind says it changed, as it does when a person clicks away.)
assert(clicked.code == nil && clicked.value["x"] != nil && js("window.seen.join(',')") as? String == "notes:change,submit")
assert(run("click", ["ref": ref("welcome card")]).code == nil && run("click", ["ref": ref("\"More\"")]).code == nil)
assert(js("window.seen.join(',')") as? String == "notes:change,submit,card,more")
let disabled = run("click", ["ref": ref("\"Later\"")])
assert(disabled.code == "browser_unknown_error" && disabled.message.contains("disabled"), disabled.message)
assert(run("hover", ["ref": ref("\"More\"")]).code == nil && run("scroll", ["deltaX": 0, "deltaY": 120]).code == nil)
// A file input takes files by their bytes.
let uploaded = run("upload", ["ref": ref("\"Avatar\""), "files": [["name": "me.png", "type": "image/png", "base64": Data("png!".utf8).base64EncodedString()]]])
assert(uploaded.code == nil, uploaded.message)
assert(js("(() => { const f = document.getElementById('avatar').files[0]; return f.name + ' ' + f.type + ' ' + f.size; })()") as? String == "me.png image/png 4")
assert(run("upload", ["ref": ref("\"Sign up\""), "files": []]).code == "browser_unknown_error")
assert(run("fill", ["ref": ref("\"Avatar\""), "value": "x"]).message.contains("browser_upload"))
// The page reads as text for `browser_wait`, and says how tall it is for a full-page picture.
assert(run("has", ["text": "It takes one minute."]).value["value"] as? Bool == true && run("has", ["text": "Nope"]).value["value"] as? Bool == false)
assert((run("size").value["height"] as? Int ?? 0) > 100)

// A new snapshot sees what changed and starts its refs again; one of a page that changed is stale.
shot = run("snapshot").value
let again = shot["snapshot"] as! String
assert(again.contains("- button \"More\" [expanded=true active ref=@e14]") && again.contains("- checkbox \"I agree\" [checked ref=@e6]") && again.contains("value=\"Pro plan\""), again)
_ = js("(document.getElementById('more').remove(), 0)")
let stale = run("click", ["ref": "@e14"])
assert(stale.code == "browser_stale_ref" && stale.message.contains("browser_snapshot"), stale.message)
assert(run("click", ["ref": "@e99"]).code == "browser_stale_ref")
assert(run("made_up").code == "browser_unsupported")

// The tool's own function runs in the page, with a ref's element when one is named.
func evaluate(_ function: String, ref: String? = nil) -> Result<Any, Error> {
    var result: Result<Any, Error>?
    web.callAsyncJavaScript(BrowserScript.evaluate, arguments: ["fn": function, "ref": ref as Any? ?? NSNull()], in: nil, in: .page) { result = $0 }
    spin(function) { result != nil }
    return result!
}
assert((try? evaluate("() => document.title").get()) as? String == "\"Sign up\"")
assert((try? evaluate("async (el) => ({ tag: el.tagName, n: 1 + 1 }) // the field", ref: "@e4").get()) as? String == "{\"tag\":\"INPUT\",\"n\":2}")
assert((try? evaluate("() => undefined").get()) as? String == "null")
assert((try? evaluate("1 + 2").get()) as? String == "3")
if case .failure(let error) = evaluate("() => { throw new Error('boom') }") {
    assert(((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String)?.contains("boom") == true)
} else { fatalError("a throwing function should fail") }
if case .failure(let error) = evaluate("(el) => el.id", ref: "@e99") {
    assert(((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String)?.contains("is not in the latest snapshot") == true)
} else { fatalError("a stale ref should fail") }

// A page far past the limits is cut short, and says so.
_ = js("(document.body.innerHTML = Array.from({ length: 900 }, (_, i) => '<button>Item ' + i + '</button>').join(''), 0)")
let big = run("snapshot").value
assert(big["truncated"] as? Bool == true && (big["stats"] as? [String: Any])?["refCount"] as? Int == 500)
assert((big["snapshot"] as! String).hasSuffix("cut short.\""))
print("Board browser automation checks passed.")
