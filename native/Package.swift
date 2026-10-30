// swift-tools-version: 5.10
import PackageDescription

// Paseo Command for macOS: the Atlas world drawn natively with SpriteKit, the
// React app in a WKWebView over it, and a native terminal drawer for the
// daemon's terminals (SwiftTerm). Release builds update themselves with Sparkle,
// whose framework bundle.sh copies into Contents/Frameworks. Builds with the
// Command Line Tools alone.
let package = Package(
    name: "PaseoCommandNative",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm", from: "1.20.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0"),
    ],
    targets: [
        .executableTarget(
            name: "PaseoCommandNative",
            dependencies: [
                .product(name: "SwiftTerm", package: "SwiftTerm"),
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            path: "Sources/PaseoCommandNative",
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
        ),
    ]
)
