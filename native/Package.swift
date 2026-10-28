// swift-tools-version: 5.10
import PackageDescription

// Paseo Command for macOS: the Atlas world drawn natively with SpriteKit, the
// React app in a WKWebView over it. Builds with the Command Line Tools alone.
let package = Package(
    name: "PaseoCommandNative",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "PaseoCommandNative", path: "Sources/PaseoCommandNative"),
    ]
)
