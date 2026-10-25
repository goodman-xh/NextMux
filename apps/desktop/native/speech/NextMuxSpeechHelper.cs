using System;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Speech.Recognition;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

[assembly: AssemblyTitle("NextMux")]
[assembly: AssemblyDescription("NextMux")]
[assembly: AssemblyProduct("NextMux")]
[assembly: AssemblyCompany("NextMux")]
[assembly: AssemblyVersion("1.2.4.0")]
[assembly: AssemblyFileVersion("1.2.4.0")]

// A small Windows-only bridge to the speech recognizers already installed in
// Windows. It has no network client, model downloader, audio file, credential
// access or keyboard injection. Standard input owns the single session.
internal static class Program
{
    private const string EngineName = "windows-system-speech";
    private static readonly object OutputLock = new object();
    private static readonly Regex LocalePattern = new Regex(
        "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$",
        RegexOptions.CultureInvariant);

    private static int Main(string[] args)
    {
        StreamWriter output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        output.AutoFlush = true;
        Console.SetOut(output);

        if (args.Length != 2 || (args[0] != "--probe" && args[0] != "--recognize")
            || !LocalePattern.IsMatch(args[1]))
        {
            return 2;
        }

        CultureInfo culture;
        try
        {
            culture = CultureInfo.GetCultureInfo(args[1]);
        }
        catch (CultureNotFoundException)
        {
            return 2;
        }

        RecognizerInfo recognizer;
        try
        {
            recognizer = FindRecognizer(culture);
        }
        catch
        {
            // A broken System.Speech installation is a helper failure, not a
            // claim that a particular language pack is absent.
            return 3;
        }

        if (args[0] == "--probe")
        {
            EmitCapability(recognizer == null ? "language-unavailable" : "ready");
            return 0;
        }
        if (recognizer == null)
        {
            EmitEnd("language-unavailable");
            return 0;
        }

        using (RecognitionSession session = new RecognitionSession(recognizer))
        {
            return session.Run();
        }
    }

    private static RecognizerInfo FindRecognizer(CultureInfo requested)
    {
        ReadOnlyCollection<RecognizerInfo> installed = SpeechRecognitionEngine.InstalledRecognizers();
        foreach (RecognizerInfo candidate in installed)
        {
            if (String.Equals(candidate.Culture.Name, requested.Name, StringComparison.OrdinalIgnoreCase))
            {
                return candidate;
            }
        }

        // A language-only request may use the sole installed regional engine.
        // Never silently substitute one region when the caller requested an
        // explicit region such as en-GB or zh-TW.
        if (requested.Name.IndexOf('-') >= 0)
        {
            return null;
        }
        RecognizerInfo match = null;
        foreach (RecognizerInfo candidate in installed)
        {
            if (!String.Equals(candidate.Culture.TwoLetterISOLanguageName,
                requested.TwoLetterISOLanguageName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            if (match != null)
            {
                return null;
            }
            match = candidate;
        }
        return match;
    }

    private static void EmitCapability(string status)
    {
        Emit("{\"type\":\"capability\",\"status\":" + Quote(status)
            + ",\"engine\":\"" + EngineName
            + "\",\"localOnly\":true,\"defaultDeviceOnly\":true}");
    }

    private static void EmitTranscript(string text, bool final)
    {
        Emit("{\"type\":\"transcript\",\"text\":" + Quote(text)
            + ",\"final\":" + (final ? "true" : "false") + "}");
    }

    private static void EmitEnd(string reason)
    {
        Emit("{\"type\":\"end\",\"reason\":" + Quote(reason) + "}");
    }

    private static void Emit(string json)
    {
        lock (OutputLock)
        {
            Console.Out.WriteLine(json);
        }
    }

    private static string Quote(string value)
    {
        StringBuilder escaped = new StringBuilder(value.Length + 2);
        escaped.Append('"');
        foreach (char character in value)
        {
            switch (character)
            {
                case '"': escaped.Append("\\\""); break;
                case '\\': escaped.Append("\\\\"); break;
                case '\b': escaped.Append("\\b"); break;
                case '\f': escaped.Append("\\f"); break;
                case '\n': escaped.Append("\\n"); break;
                case '\r': escaped.Append("\\r"); break;
                case '\t': escaped.Append("\\t"); break;
                default:
                    if (character < 0x20 || character == '\u2028' || character == '\u2029')
                    {
                        escaped.Append("\\u");
                        escaped.Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        escaped.Append(character);
                    }
                    break;
            }
        }
        escaped.Append('"');
        return escaped.ToString();
    }

    // The wire snapshot covers the entire user-started session, with a
    // replaceable current utterance and a committed prefix across pauses.
    private sealed class DictationTranscript
    {
        private string committed = String.Empty;
        private string current = String.Empty;

        internal string Revise(string value)
        {
            string next = (value ?? String.Empty).Trim();
            if (next.Length > 0) current = next;
            return Join(committed, current);
        }

        internal string Commit(string value)
        {
            // Empty stop/final callbacks do not erase an already heard partial.
            committed = Revise(value);
            current = String.Empty;
            return committed;
        }

        private static string Join(string prefix, string suffix)
        {
            if (prefix.Length == 0) return suffix;
            if (suffix.Length == 0) return prefix;
            return prefix + (NeedsSpace(prefix[prefix.Length - 1], suffix[0]) ? " " : String.Empty) + suffix;
        }

        private static bool NeedsSpace(char left, char right)
        {
            return Char.IsLetterOrDigit(left) && Char.IsLetterOrDigit(right)
                && !IsCjk(left) && !IsCjk(right);
        }

        private static bool IsCjk(char value)
        {
            return (value >= '\u3400' && value <= '\u9fff')
                || (value >= '\u3040' && value <= '\u30ff')
                || (value >= '\uac00' && value <= '\ud7af');
        }
    }

    private sealed class RecognitionSession : IDisposable
    {
        private readonly SpeechRecognitionEngine engine;
        private readonly ManualResetEvent completed = new ManualResetEvent(false);
        private readonly object stateLock = new object();
        private Timer sessionTimer;
        private Timer finishTimer;
        private bool ended;
        private bool finishing;
        private readonly DictationTranscript transcript = new DictationTranscript();
        private long lastLevelAt;
        private bool sentLevel;

        internal RecognitionSession(RecognizerInfo recognizer)
        {
            engine = new SpeechRecognitionEngine(recognizer);
            engine.AudioLevelUpdated += OnAudioLevelUpdated;
            engine.SpeechHypothesized += OnSpeechHypothesized;
            engine.SpeechRecognized += OnSpeechRecognized;
            engine.RecognizeCompleted += OnRecognizeCompleted;
        }

        internal int Run()
        {
            try
            {
                engine.LoadGrammar(new DictationGrammar());
            }
            catch
            {
                End("language-unavailable");
                return 0;
            }
            try
            {
                engine.SetInputToDefaultAudioDevice();
            }
            catch
            {
                End("device-unavailable");
                return 0;
            }

            try
            {
                engine.RecognizeAsync(RecognizeMode.Multiple);
            }
            catch
            {
                End("recognition-failed");
                return 0;
            }

            Thread input = new Thread(ReadOwnerCommand);
            input.IsBackground = true;
            input.Name = "NextMux speech owner";
            input.Start();
            sessionTimer = new Timer(delegate { Finish(); }, null, 300000, Timeout.Infinite);
            Emit("{\"type\":\"listening\"}");
            completed.WaitOne();
            return 0;
        }

        private void ReadOwnerCommand()
        {
            string command;
            try
            {
                command = Console.ReadLine();
            }
            catch
            {
                command = null;
            }
            if (command == "finish")
            {
                Finish();
            }
            else
            {
                Cancel();
            }
        }

        private void OnAudioLevelUpdated(object sender, AudioLevelUpdatedEventArgs eventArgs)
        {
            lock (stateLock)
            {
                if (ended || finishing) return;
                long now = Stopwatch.GetTimestamp();
                if (sentLevel && (now - lastLevelAt) / (double)Stopwatch.Frequency < 0.1) return;
                lastLevelAt = now;
                sentLevel = true;
                // The engine measures the same default input used by recognition.
                double level = Math.Max(0, Math.Min(1, eventArgs.AudioLevel / 100.0));
                Emit("{\"type\":\"level\",\"value\":"
                    + level.ToString("0.###", CultureInfo.InvariantCulture) + "}");
            }
        }

        private void OnSpeechHypothesized(object sender, SpeechHypothesizedEventArgs eventArgs)
        {
            string value;
            lock (stateLock)
            {
                if (ended || finishing || eventArgs.Result == null)
                {
                    return;
                }
                value = transcript.Revise(eventArgs.Result.Text);
            }
            if (value.Length > 10000)
            {
                End("text-limit");
                return;
            }
            EmitTranscript(value, false);
        }

        private void OnSpeechRecognized(object sender, SpeechRecognizedEventArgs eventArgs)
        {
            string value;
            lock (stateLock)
            {
                if (ended || eventArgs.Result == null)
                {
                    return;
                }
                value = transcript.Commit(eventArgs.Result.Text);
            }
            if (value.Length > 10000)
            {
                End("text-limit");
                return;
            }
            EmitTranscript(value, true);
        }

        private void OnRecognizeCompleted(object sender, RecognizeCompletedEventArgs eventArgs)
        {
            bool wasFinishing;
            lock (stateLock)
            {
                if (ended)
                {
                    return;
                }
                wasFinishing = finishing;
            }
            End(wasFinishing ? "stopped" : eventArgs.Error == null ? "completed" : "recognition-failed");
        }

        private void Finish()
        {
            lock (stateLock)
            {
                if (ended || finishing)
                {
                    return;
                }
                finishing = true;
            }
            finishTimer = new Timer(delegate { End("stopped"); }, null, 3000, Timeout.Infinite);
            try
            {
                engine.RecognizeAsyncStop();
            }
            catch
            {
                End("stopped");
            }
        }

        private void Cancel()
        {
            End("cancelled");
            try
            {
                engine.RecognizeAsyncCancel();
            }
            catch
            {
                // The owner is already gone and End is idempotent.
            }
        }

        private void End(string reason)
        {
            lock (stateLock)
            {
                if (ended)
                {
                    return;
                }
                ended = true;
            }
            EmitEnd(reason);
            completed.Set();
        }

        public void Dispose()
        {
            if (sessionTimer != null) sessionTimer.Dispose();
            if (finishTimer != null) finishTimer.Dispose();
            completed.Dispose();
            engine.AudioLevelUpdated -= OnAudioLevelUpdated;
            engine.Dispose();
        }
    }
}
