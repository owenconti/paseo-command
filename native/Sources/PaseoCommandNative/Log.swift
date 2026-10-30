import Foundation

enum Log {
    static func line(_ text: String) {
        FileHandle.standardError.write("[paseo-native] \(text)\n".data(using: .utf8)!)
    }
}
