import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { AtlasVoiceOrb, type OrbState } from "./AtlasVoiceOrb";

type AtlasMessage = { role: "user" | "atlas"; text: string };

type Props = {
  history: AtlasMessage[];
  sending: boolean;
  sendMessage: (text: string) => Promise<void>;
  onClose: () => void;
};

const SpeechRecognitionCtor: typeof window.SpeechRecognition | undefined =
  typeof window !== "undefined"
    ? window.SpeechRecognition ?? (window as any).webkitSpeechRecognition
    : undefined;

const STATE_LABELS: Record<OrbState, { label: string; color: string }> = {
  idle: { label: "Inactive", color: "#8e8e93" },
  listening: { label: "Listening", color: "#4da3ff" },
  thinking: { label: "Thinking", color: "#e8a33d" },
  speaking: { label: "Talking", color: "#34c979" },
};

export function VoiceModeOverlay({ history, sending, sendMessage, onClose }: Props) {
  const [listening, setListening] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const micRef = useRef<{ analyser: AnalyserNode; dataArray: Uint8Array<ArrayBuffer> } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const closedRef = useRef(false);
  const lastSpokenIndexRef = useRef(-1);

  const sendingRef = useRef(sending);
  const ttsSpeakingRef = useRef(ttsSpeaking);
  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);
  useEffect(() => {
    ttsSpeakingRef.current = ttsSpeaking;
  }, [ttsSpeaking]);

  const orbState: OrbState = sending ? "thinking" : ttsSpeaking ? "speaking" : listening ? "listening" : "idle";

  useEffect(() => {
    closedRef.current = false;

    if (!SpeechRecognitionCtor) {
      setError("Voice input isn't supported in this browser — try Chrome or Edge.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((stream) => {
        if (closedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        micRef.current = {
          analyser,
          dataArray: new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>,
        };
      })
      .catch(() => {
        setError("Couldn't access your microphone — check your browser's permission settings.");
      });

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.start = () => {
      setListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      setTranscript(finalText || interimText);
      if (finalText.trim()) {
        setListening(false);
        setTranscript("");
        sendMessage(finalText.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(`Voice recognition error: ${event.error}`);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      if (!closedRef.current && !sendingRef.current && !ttsSpeakingRef.current) {
        if (!closedRef.current) startListening();
      }
    };

    recognitionRef.current = recognition;
    startListening();

    return () => {
      closedRef.current = true;
      recognitionRef.current?.abort();
      playbackRef.current?.pause();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startListening() {
    if (!recognitionRef.current || closedRef.current) return;
    setError(null);
    try {
      recognitionRef.current.start();
    } catch (err) {
      // InvalidStateError means recognition is already running — sync the UI to match
      // instead of silently ignoring it, so "Tap to talk" never gets stuck stale.
      if (err instanceof DOMException && err.name === "InvalidStateError") {
        setListening(true);
      }
    }
  }

  async function speak(text: string) {
    playbackRef.current?.pause();
    setTtsSpeaking(true);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      const res = await fetch("/api/atlas/speak", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error(`TTS endpoint returned ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      playbackRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setTtsSpeaking(false);
        if (!closedRef.current) startListening();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setTtsSpeaking(false);
      };

      await audio.play();
    } catch {
      setError("Couldn't play Atlas's voice — check /api/atlas/speak.");
      setTtsSpeaking(false);
    }
  }

  useEffect(() => {
    if (sending) return;
    const last = history[history.length - 1];
    const lastIndex = history.length - 1;
    if (last?.role === "atlas" && lastIndex > lastSpokenIndexRef.current) {
      lastSpokenIndexRef.current = lastIndex;
      speak(last.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, sending]);

  function handleClose() {
    closedRef.current = true;
    recognitionRef.current?.abort();
    playbackRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    onClose();
  }

  const stateInfo = STATE_LABELS[orbState];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#1c1c1c] text-white">
      <button
        onClick={handleClose}
        aria-label="Close voice mode"
        className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/70 hover:bg-white/10 hover:text-white"
      >
        ✕
      </button>

      <div className="h-80 w-80 sm:h-[26rem] sm:w-[26rem]">
        <AtlasVoiceOrb state={orbState} micRef={micRef} />
      </div>

      <div className="mt-8 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full transition-colors duration-300"
          style={{ backgroundColor: stateInfo.color }}
        />
        <span className="text-sm font-medium text-white/80">{stateInfo.label}</span>
      </div>

      {listening && transcript && (
        <p className="mt-2 max-w-md px-6 text-center text-sm text-white/50">{transcript}</p>
      )}

      {error && <p className="mt-3 max-w-sm px-6 text-center text-xs text-white/50">{error}</p>}

      {!listening && !sending && !ttsSpeaking && !error && (
        <button
          onClick={startListening}
          className="mt-6 rounded-full bg-white px-5 py-2 text-sm font-medium text-ink transition-opacity active:opacity-70"
        >
          Tap to talk
        </button>
      )}
    </div>
  );
}