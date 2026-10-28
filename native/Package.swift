// swift-tools-version: 5.10
import PackageDescription

// Paseo Command for macOS: the Atlas world drawn natively with SpriteKit, the
// React app in a WKWebView over it, and a native terminal drawer for the
// daemon's terminals (SwiftTerm). Builds with the Command Line Tools alone.
let package = Package(
    name: "PaseoCommandNative",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm", from: "1.20.0"),
    ],
    targets: [
        .executableTarget(
            name: "PaseoCommandNative",
            dependencies: [.product(name: "SwiftTerm", package: "SwiftTerm")],
            path: "Sources/PaseoCommandNative"
        ),
    ]
)
