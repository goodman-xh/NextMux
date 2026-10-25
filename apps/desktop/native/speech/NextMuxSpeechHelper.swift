import Foundation
import AVFoundation
import Speech
import Darwin

// A single local-only recognition session per process. No audio files, network
// clients, automatic model installation or credentials are used here.
let arguments = CommandLine.arguments
guard arguments.count == 3, ["--probe", "--recognize"].contains(arguments[1]),
      arguments[2].range(of: "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$", options: .regularExpression) != nil else { exit(2) }
// Speech recognition and the microphone are permissions macOS grants to the *responsible* app, not to this
// helper. Started by an app that does not declare them (NextMux run from a terminal or a development build),
// macOS kills the helper instead of asking. So recognition runs in a copy of the helper that answers for
// itself, with its own Info.plist and its own permission prompt. The stdio pipes are shared, so the parent
// only waits, passes on a stop signal and exits with the copy's status.
var ownChild: pid_t = 0
if arguments[1] == "--recognize", ProcessInfo.processInfo.environment["NEXTMUX_SPEECH_OWN"] == nil,
   let executable = Bundle.main.executablePath,
   let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim") {
    typealias Disclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
    var attributes: posix_spawnattr_t?
    posix_spawnattr_init(&attributes)
    if unsafeBitCast(symbol, to: Disclaim.self)(&attributes, 1) == 0 {
        setenv("NEXTMUX_SPEECH_OWN", "1", 1)
        let argv: [UnsafeMutablePointer<CChar>?] = arguments.map { strdup($0) } + [nil]
        let spawned = posix_spawn(&ownChild, executable, nil, &attributes, argv, environ)
        posix_spawnattr_destroy(&attributes)
        if spawned == 0 {
            for signalNumber in [SIGTERM, SIGINT, SIGHUP] {
                signal(signalNumber) { received in if ownChild > 0 { kill(ownChild, received) } }
            }
            var status: Int32 = 0
            while waitpid(ownChild, &status, 0) < 0 && errno == EINTR {}
            let code = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
            exit(code)
        }
    } else {
        posix_spawnattr_destroy(&attributes)
    }
}

let locale = Locale(identifier: arguments[2])
let recognizer = SFSpeechRecognizer(locale: locale)

func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

func capability() -> [String: Any] {
    let speech = SFSpeechRecognizer.authorizationStatus()
    let audio = AVCaptureDevice.authorizationStatus(for: .audio)
    let local = recognizer?.supportsOnDeviceRecognition == true
    let denied = speech == .denied || speech == .restricted || audio == .denied || audio == .restricted
    return ["type": "capability", "status": !local ? "language-unavailable" : denied ? "permission-denied"
        : speech == .authorized && audio == .authorized ? "ready" : "permission-required",
        "engine": "macos-speech", "localOnly": true, "defaultDeviceOnly": true]
}

if arguments[1] == "--probe" { emit(capability()); exit(0) }

// Each native task may revise its current utterance. Only an explicit task or
// utterance completion commits it; a shorter partial is a correction, not a new
// utterance. The IPC text is always the complete text of this user-started session.
struct DictationTranscript {
    private(set) var committed = ""
    private(set) var current = ""

    var text: String { Self.join(committed, current) }

    mutating func revise(_ value: String) -> String {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        // Some recognizers finish with an empty snapshot. It carries no revision
        // and must not erase the last words already shown to the person.
        if !value.isEmpty { current = value }
        return text
    }

    mutating func commit() {
        committed = text
        current = ""
    }

    private static func join(_ left: String, _ right: String) -> String {
        guard let last = left.unicodeScalars.last else { return right }
        guard let first = right.unicodeScalars.first else { return left }
        func isCjk(_ scalar: Unicode.Scalar) -> Bool {
            (0x3400...0x9fff).contains(scalar.value)
                || (0x3040...0x30ff).contains(scalar.value)
                || (0xac00...0xd7af).contains(scalar.value)
        }
        let space = CharacterSet.alphanumerics.contains(last) && CharacterSet.alphanumerics.contains(first)
            && !isCjk(last) && !isCjk(first)
        return left + (space ? " " : "") + right
    }
}

final class RecognitionSession {
    private let engine = AVAudioEngine()
    private let requestLock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var taskGeneration = 0
    private var transcript = DictationTranscript()
    private var tapInstalled = false
    private var ended = false
    private var finishing = false
    // Accessed only by the audio tap; no separate capture stream or audio persistence.
    private var lastLevelAt: TimeInterval = -1
    private var finishTimeout: DispatchWorkItem?
    private var signals: [DispatchSourceSignal] = []

    func end(_ reason: String) {
        guard !ended else { return }
        ended = true
        taskGeneration += 1
        finishTimeout?.cancel()
        stopAudio()
        task?.cancel()
        task = nil
        emit(["type": "end", "reason": reason])
        exit(0)
    }

    private func stopAudio() {
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        replaceRequest(nil)?.endAudio()
    }

    @discardableResult
    private func replaceRequest(_ replacement: SFSpeechAudioBufferRecognitionRequest?) -> SFSpeechAudioBufferRecognitionRequest? {
        requestLock.lock()
        let previous = request
        request = replacement
        requestLock.unlock()
        return previous
    }

    func finish() {
        guard !ended, !finishing else { return }
        finishing = true
        stopAudio()
        guard task != nil else { end("cancelled"); return }
        let timeout = DispatchWorkItem { self.end("stopped") }
        finishTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: timeout)
    }

    func begin() {
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { self.end("cancelled") }
            source.resume()
            signals.append(source)
        }
        // Closing the owner or pipe always releases capture, including while
        // a system permission dialog is pending.
        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine() {
                DispatchQueue.main.async {
                    if line == "finish" { self.finish() }
                    else { self.end("cancelled") }
                }
            }
            DispatchQueue.main.async { self.end("cancelled") }
        }
        guard recognizer?.supportsOnDeviceRecognition == true else { end("language-unavailable"); return }
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: requestMicrophone()
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async {
                    if status == .authorized { self.requestMicrophone() }
                    else { self.end("permission-denied") }
                }
            }
        default: end("permission-denied")
        }
    }

    private func requestMicrophone() {
        guard !ended, !finishing else { return }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: startRecognition()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    if granted { self.startRecognition() }
                    else { self.end("permission-denied") }
                }
            }
        default: end("permission-denied")
        }
    }

    private static func audioLevel(_ buffer: AVAudioPCMBuffer) -> Double {
        guard let samples = buffer.floatChannelData else { return 0 }
        let frames = Int(buffer.frameLength), channels = Int(buffer.format.channelCount)
        guard frames > 0, channels > 0 else { return 0 }
        var squares: Double = 0
        if buffer.format.isInterleaved {
            for index in 0..<(frames * channels) {
                let value = Double(samples[0][index]); squares += value * value
            }
        } else {
            for channel in 0..<channels {
                for frame in 0..<frames {
                    let value = Double(samples[channel][frame]); squares += value * value
                }
            }
        }
        guard squares.isFinite else { return 0 }
        // Bounded intensity, not a claim that the sound is human speech.
        return min(1, max(0, sqrt(squares / Double(frames * channels)) * 8))
    }

    private func startRecognition() {
        guard !ended, !finishing, let recognizer = recognizer, recognizer.supportsOnDeviceRecognition else { return }
        guard recognizer.isAvailable else { end("language-unavailable"); return }
        startTask(recognizer)
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { end("device-unavailable"); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self else { return }
            // Keep the same capture engine across completed utterances. A tiny
            // pointer handoff makes each buffer belong to exactly one task.
            self.requestLock.lock()
            self.request?.append(buffer)
            self.requestLock.unlock()
            let now = ProcessInfo.processInfo.systemUptime
            guard now - self.lastLevelAt >= 0.1 else { return }
            self.lastLevelAt = now
            let level = Self.audioLevel(buffer)
            // JSON/stdio stay off the real-time audio callback. Stop/finish owns
            // this event too, so an already queued sample cannot keep a ring alive.
            DispatchQueue.main.async {
                guard !self.ended, !self.finishing else { return }
                emit(["type": "level", "value": level])
            }
        }
        tapInstalled = true
        do { engine.prepare(); try engine.start(); emit(["type": "listening"]) }
        catch { end("device-unavailable") }
        // One bound for the entire user-started session, not per utterance.
        DispatchQueue.main.asyncAfter(deadline: .now() + 300) { self.finish() }
    }

    private func startTask(_ recognizer: SFSpeechRecognizer) {
        guard !ended, !finishing else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        taskGeneration += 1
        let generation = taskGeneration
        let previousRequest = replaceRequest(request)
        let previousTask = task
        task = recognizer.recognitionTask(with: request) { result, error in
            DispatchQueue.main.async {
                guard !self.ended, generation == self.taskGeneration else { return }
                if let result = result {
                    let text = self.transcript.revise(result.bestTranscription.formattedString)
                    guard text.utf16.count <= 10_000 else { self.end("text-limit"); return }
                    // Local recognition can complete an utterance after a pause
                    // without setting isFinal. Its completed speech metadata is
                    // the boundary used by continuous native implementations;
                    // rotate the task here so a later utterance cannot replace it.
                    let utteranceComplete = result.isFinal || (result.speechRecognitionMetadata?.speechDuration ?? 0) > 0
                    if !text.isEmpty { emit(["type": "transcript", "text": text, "final": utteranceComplete]) }
                    if utteranceComplete {
                        self.transcript.commit()
                        if self.finishing { self.end("stopped") }
                        else { self.startTask(recognizer) }
                        return
                    }
                }
                if error != nil { self.end(self.finishing ? "stopped" : "recognition-failed") }
            }
        }
        previousRequest?.endAudio()
        previousTask?.cancel()
    }
}

let session = RecognitionSession()
DispatchQueue.main.async { session.begin() }
RunLoop.main.run()
