import Foundation

// After an update installs, only a page on the app's own origin comes back.
assert(Updater.restoreURL(saved: "http://127.0.0.1:4310/?agent=a", port: 4310) == URL(string: "http://127.0.0.1:4310/?agent=a"))
for saved in ["http://127.0.0.1:4321/?agent=a", "http://localhost:4310/", "https://127.0.0.1:4310/",
              "https://untrusted.example/", "about:blank", ""] {
    assert(Updater.restoreURL(saved: saved, port: 4310) == nil, saved)
}
assert(Updater.restoreURL(saved: nil, port: 4310) == nil)
print("Updater restore checks passed.")
