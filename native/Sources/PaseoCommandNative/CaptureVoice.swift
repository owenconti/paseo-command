import AVFoundation
import Foundation
import Speech

/// Your voice in a screen capture: the Microphone permission, and what you said, heard on this Mac from the
/// recording's sound (Apple's `SpeechAnalyzer` with a `SpeechTranscriber`, macOS 26; nothing leaves the Mac, and it
/// needs no Speech Recognition permission). The microphone is recorded from macOS 15 (`CaptureRecorder`); before 26
/// the capture keeps its sound without a transcript.
enum CaptureVoice {
    /// Whether to record the microphone with a capture: the menu bar's Record Your Voice and the capsule's mic, kept
    /// in the app's preferences (on by default).
    static var wanted: Bool {
        get { UserDefaults.standard.object(forKey: "captureVoice") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "captureVoice") }
    }

    /// The microphone can be recorded at all (ScreenCaptureKit's, macOS 15).
    static var recordable: Bool {
        if #available(macOS 15, *) { return true }
        return false
    }

    static var transcribes: Bool {
        if #available(macOS 26, *) { return true }
        return false
    }

    enum Permission { case allowed, denied, undecided }
    static var permission: Permission {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .allowed
        case .notDetermined: return .undecided
        default: return .denied
        }
    }

    /// Asks macOS for the microphone (its prompt only while undecided); whether it's allowed.
    static func ask() async -> Bool {
        switch permission {
        case .allowed: return true
        case .denied: return false
        case .undecided: return await AVCaptureDevice.requestAccess(for: .audio)
        }
    }

    /// The language to hear: the Mac's, as the transcriber knows it, or nil when it can't transcribe it.
    @available(macOS 26, *)
    static func locale() async -> Locale? {
        await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current)
    }

    @available(macOS 26, *)
    private static func transcriber(_ locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
    }

    /// Makes sure the language's model is on the Mac (macOS downloads it the first time), while you record, so
    /// hearing what you said needn't wait for it after.
    static func prepare() {
        guard #available(macOS 26, *) else { return }
        Task.detached(priority: .utility) {
            guard let locale = await locale() else { return }
            do {
                if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber(locale)]) {
                    Log.line("capture: downloading the speech model for \(locale.identifier)")
                    try await request.downloadAndInstall()
                }
            } catch {
                Log.line("capture: couldn't get the speech model for \(locale.identifier): \(error.localizedDescription)")
            }
        }
    }

    /// The words said in `url`'s sound, each timed from the file's start. Throws `CaptureError` saying why when it can't.
    static func words(in url: URL, timeout: Double = 90) async throws -> [CaptureWord] {
        guard #available(macOS 26, *) else { throw CaptureError("Hearing what you said needs macOS 26") }
        guard let locale = await locale() else { throw CaptureError("macOS can't transcribe \(Locale.current.localizedString(forIdentifier: Locale.current.identifier) ?? Locale.current.identifier)") }
        return try await withThrowingTaskGroup(of: [CaptureWord].self) { group in
            group.addTask { try await hear(url, locale: locale) }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                throw CaptureError("Hearing what you said took too long")
            }
            defer { group.cancelAll() }
            return try await group.next() ?? []
        }
    }

    @available(macOS 26, *)
    private static func hear(_ url: URL, locale: Locale) async throws -> [CaptureWord] {
        let transcriber = transcriber(locale)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
        let file = try AVAudioFile(forReading: url)
        let results = Task { () throws -> [CaptureWord] in
            var words: [CaptureWord] = []
            for try await result in transcriber.results {
                for run in result.text.runs {
                    let text = String(result.text[run.range].characters)
                    guard let range = run.audioTimeRange else {
                        // A run without a time (spacing): it belongs to the word before.
                        if !words.isEmpty, !text.trimmingCharacters(in: .whitespaces).isEmpty { words[words.count - 1].text += text }
                        continue
                    }
                    words.append(CaptureWord(text: text, t: range.start.seconds, end: range.end.seconds))
                }
            }
            return words
        }
        do {
            let analyzer = try await SpeechAnalyzer(inputAudioFile: file, modules: [transcriber], finishAfterFile: true)
            return try await withTaskCancellationHandler {
                let words = try await results.value
                _ = analyzer
                return words
            } onCancel: {
                results.cancel()
            }
        } catch {
            results.cancel()
            throw error
        }
    }
}
