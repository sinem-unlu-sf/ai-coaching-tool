'use client';

import { useState, useRef, useEffect } from 'react';

type SessionStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface SessionScreenProps {
  sessionId?: string;
  selectedTraits: string[];
  onSessionEnd: (summary: string) => void;
}

declare global {
  interface Window {
    puter?: any;
  }
}

const USE_PUTER = true;
const PUTER_SCRIPT_ID = 'puter-js-sdk';
const TARGET_MIN_WORDS = 60;
const TARGET_MAX_WORDS = 90;
const MAX_HISTORY_TURNS = 1;
const FAST_MODE = true;
const CHAT_MODEL = 'gemini-2.5-flash-lite';
const TTS_LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'it-IT', label: 'Italian' },
];
const TTS_ENGINES: Array<'standard' | 'neural' | 'generative'> = ['standard', 'neural', 'generative'];

const loadPuterScript = () =>
  new Promise<void>((resolve, reject) => {
    if ((window as any).puter) return resolve();

    const existing = document.getElementById(PUTER_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Puter.js')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = PUTER_SCRIPT_ID;
    script.src = 'https://js.puter.com/v2/';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Puter.js'));
    document.head.appendChild(script);
  });

const getPuter = async () => {
  await loadPuterScript();
  const puter = (window as any).puter;
  if (!puter) throw new Error('Puter.js not loaded');
  return puter;
};

const ensurePuterAuth = async () => {
  const puter = await getPuter();
  try {
    const signedIn = await puter.auth.isSignedIn();
    if (!signedIn) await puter.auth.signIn();
  } catch {
    await puter.auth.signIn();
  }
  return puter;
};

function extractPuterText(response: any): string {
  if (typeof response === 'string') return response;
  const fromMessage = response?.message?.content;
  if (Array.isArray(fromMessage)) {
    const textPart = fromMessage.find((p: any) => p?.text)?.text;
    if (textPart) return textPart;
  }
  if (typeof fromMessage === 'string') return fromMessage;
  return response?.text || '';
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function looksTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const tail = t.split(/\s+/).slice(-3).join(' ').toLowerCase();
  return /(and|but|because|so|or|with|to|of|that|which|who|i|we|you)\.?$/.test(tail);
}

function normalizeAiResponse(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}

function trimToWordLimit(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  const trimmed = words.slice(0, maxWords).join(' ');
  const lastSentenceMatch = trimmed.match(/^(.*?[.!?])\s*[^.!?]*$/);
  return lastSentenceMatch?.[1]?.trim() || trimmed.trim();
}

function mimeToExtension(mimeType?: string) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

export default function SessionScreen({ sessionId, selectedTraits, onSessionEnd }: SessionScreenProps) {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRequestSummary, setCanRequestSummary] = useState(false);
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean>(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [ttsLanguage, setTtsLanguage] = useState<string>('en-US');
  const [ttsEngine, setTtsEngine] = useState<'standard' | 'neural' | 'generative'>('standard');

  // Local session id state (start/refresh session if needed)
  const [localSessionId, setLocalSessionId] = useState<string | null>(sessionId || null);
  const startingSessionRef = useRef<Promise<string | null> | null>(null);
  const retryingRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [conversationHistory, setConversationHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  useEffect(() => {
    // keep localSessionId in sync if parent passes a different prop
    if (sessionId) {
      setLocalSessionId(sessionId);
      try {
        localStorage.setItem('sessionId', sessionId);
      } catch {}
    } else {
      // try to restore from localStorage (dev convenience)
      try {
        const stored = localStorage.getItem('sessionId');
        if (stored) setLocalSessionId(stored);
      } catch {}
    }
  }, [sessionId]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [micStream]);

  useEffect(() => {
    if (!micPermissionGranted) return;
    ensurePuterAuth().catch(() => {
      // no-op: auth prompt might be blocked without user gesture
    });
  }, [micPermissionGranted]);

  const startSession = async (traits: string[] = selectedTraits || []) => {
    // dedupe concurrent starts
    if (startingSessionRef.current) return startingSessionRef.current;
    const p = (async () => {
      try {
        setError(null);
        console.log('[client] starting session with traits', traits);
        const res = await fetch('/api/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ traits }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = json?.error || res.statusText || 'Failed to start session';
          throw new Error(msg);
        }
        // accept multiple possible keys
        const sid = json.sessionId || json.session_id || json.id || json.session || null;
        if (!sid) {
          throw new Error('No session id returned from server');
        }
        setLocalSessionId(sid);
        try {
          localStorage.setItem('sessionId', sid);
        } catch {}
        console.log('[client] session started', sid);
        return sid;
      } catch (err: any) {
        console.error('[client] startSession error', err);
        setError('Failed to start session. See console for details.');
        setLocalSessionId(null);
        throw err;
      } finally {
        startingSessionRef.current = null;
      }
    })();
    startingSessionRef.current = p;
    return p;
  };

  const enableMicrophone = async () => {
    try {
      setError(null);
      // Request microphone access - must be called from user gesture
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      setMicStream(stream);
      setMicPermissionGranted(true);
      setError(null);

      // ensure session exists before user can record
      if (!localSessionId) {
        try {
          await startSession();
        } catch {
          // startSession sets error
        }
      }
    } catch (err: any) {
      console.error('[client] microphone error', err);
      setMicPermissionGranted(false);
      setMicStream(null);
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Microphone permission denied. Allow microphone access and try again.');
      } else if (name === 'NotFoundError') {
        setError('No microphone found.');
      } else {
        setError('Microphone error. See console for details.');
      }
    }
  };

  const startRecording = () => {
    if (!micPermissionGranted || !micStream) {
      setError('Please enable microphone first.');
      return;
    }

    if (startingSessionRef.current) {
      // if session is being started, wait for it to complete before recording
      setError('Preparing session... please try again in a moment.');
      return;
    }

    try {
      setError(null);
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorder not supported');
      }

      const stream = micStream;
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else {
        mimeType = '';
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          console.log('[client] audio chunk captured:', e.data.size);
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onerror = (e) => {
        console.error('[client] mediaRecorder error', e);
        setError('Recording error occurred');
        setIsRecording(false);
        setStatus('idle');
      };

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length === 0) {
          setError('No audio captured');
          setStatus('idle');
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        console.log('[client] recording stopped, total size:', blob.size, 'chunks:', audioChunksRef.current.length);
        await processTurn(blob, mimeType);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setStatus('listening');
    } catch (err: any) {
      console.error('[client] startRecording error', err);
      setError('Unable to start recording');
      setIsRecording(false);
      setStatus('idle');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setStatus('thinking');
  };

  const processTurnWithPuter = async (audioBlob: Blob, recordedMimeType?: string) => {
    try {
      setStatus('thinking');
      setError(null);

      const puter = await ensurePuterAuth();

      // STT
      const ext = mimeToExtension(recordedMimeType);
      const file = new File([audioBlob], `audio.${ext}`, { type: recordedMimeType || 'audio/webm' });

      let sttResult: any;
      try {
        sttResult = await puter.ai.speech2txt(file, { model: 'gpt-4o-mini-transcribe' });
      } catch {
        sttResult = await puter.ai.speech2txt({ file, model: 'gpt-4o-mini-transcribe' });
      }

      const userText = (sttResult?.text || sttResult || '').toString().trim();
      if (!userText) throw new Error('No transcription returned');

      const limitedHistory = historyRef.current.slice(-MAX_HISTORY_TURNS * 2);
      const nextHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...limitedHistory,
        { role: 'user', content: userText },
      ];
      const systemPrompt = buildSystemPrompt(userText);

      // LLM (Puter expects a simple prompt; avoid unsupported params)
      const prompt = [
        `System: ${systemPrompt}`,
        ...nextHistory.map((m) => `${m.role === 'user' ? 'User' : 'Coach'}: ${m.content}`),
        'Coach:',
      ].join('\n');

      let llmResponse = await puter.ai.chat(prompt, {
        model: CHAT_MODEL,
      });

      let aiText = extractPuterText(llmResponse);
      aiText = normalizeAiResponse(aiText);

      const needsRepair =
        wordCount(aiText) < TARGET_MIN_WORDS || !/[.!?]$/.test(aiText.trim());
      if (needsRepair && !FAST_MODE) {
        const repairPrompt = `Rewrite the following coaching response so it is ${TARGET_MIN_WORDS}–${TARGET_MAX_WORDS} words and composed of complete, well‑formed sentences. Keep the same meaning and tone. Do not add new topics. Include at least one reflective question. Avoid fragments.\n\nResponse:\n${aiText}`;
        const repairResp = await puter.ai.chat(repairPrompt, {
          model: CHAT_MODEL,
        });
        aiText = normalizeAiResponse(extractPuterText(repairResp));
      }

      if (wordCount(aiText) > TARGET_MAX_WORDS) {
        aiText = trimToWordLimit(aiText, TARGET_MAX_WORDS);
      }

      // update history
      const updatedHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...nextHistory,
        { role: 'assistant', content: aiText },
      ];
      historyRef.current = updatedHistory;
      setConversationHistory(updatedHistory);

      // TTS
      setStatus('speaking');
      const audio = await puter.ai.txt2speech(aiText, {
        engine: ttsEngine,
        language: ttsLanguage,
      });

      audio.onended = () => {
        setStatus('idle');
        setCanRequestSummary(true);
      };
      audio.onerror = () => {
        setError('Failed to play response audio');
        setStatus('idle');
      };

      audio.play().catch(() => {
        setError('Failed to play response audio');
        setStatus('idle');
      });
    } catch (err: any) {
      console.error('[client] puter turn error', err);
      setError(err?.message || 'Puter turn failed');
      setStatus('idle');
    }
  };

  const processTurn = async (audioBlob: Blob, recordedMimeType?: string) => {
    if (USE_PUTER) {
      await processTurnWithPuter(audioBlob, recordedMimeType);
      return;
    }

    try {
      setStatus('thinking');
      setError(null);

      // ensure session exists (create if missing)
      let sid = localSessionId;
      if (!sid) {
        try {
          sid = await startSession();
        } catch {
          setStatus('idle');
          return;
        }
      }

      const doTurn = async (usedSid: string) => {
        // build form + multi-location session id and query param
        const form = new FormData();
        
        // Determine file extension based on MIME type
        let extension = 'webm';
        if (recordedMimeType?.includes('mp4')) {
          extension = 'mp4';
        } else if (recordedMimeType?.includes('ogg')) {
          extension = 'ogg';
        } else if (recordedMimeType?.includes('wav')) {
          extension = 'wav';
        }
        
        form.append('audio', audioBlob, `audio.${extension}`);
        form.append('sessionId', usedSid);
        form.append('session_id', usedSid);

        const url = `/api/session/turn?sessionId=${encodeURIComponent(usedSid)}`;

        console.log('[client] sending turn', { 
          url, 
          size: audioBlob.size, 
          sid: usedSid,
          blobType: audioBlob.type,
          recordedMimeType 
        });

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'X-Session-Id': usedSid }, // include header too
          body: form,
        });

        const ct = res.headers.get('content-type') || '';
        const isJson = ct.includes('application/json');

        if (!res.ok) {
          let errData: any = {};
          if (isJson) {
            errData = await res.json().catch(() => ({}));
          }
          const msg = errData?.error || errData?.message || res.statusText || `HTTP ${res.status}`;
          // server-side message detection for "session not found"
          if (/session not found/i.test(msg) || res.status === 404) {
            throw new Error('SESSION_NOT_FOUND');
          }
          throw new Error(msg);
        }

        if (isJson) return res.json();
        return res.json().catch(() => ({}));
      };

      try {
        const data = await doTurn(sid);
        await handleTurnResponse(data);
      } catch (err: any) {
        const msg = err?.message || '';
        if (!retryingRef.current && msg === 'SESSION_NOT_FOUND') {
          // try recreate session once and retry
          retryingRef.current = true;
          try {
            const newSid = await startSession();
            const data = await doTurn(newSid as string);
            await handleTurnResponse(data);
          } catch (e) {
            console.error('[client] retry after session recreation failed', e);
            setError('Turn failed after recreating session');
            setStatus('idle');
          } finally {
            retryingRef.current = false;
          }
        } else {
          console.error('[client] doTurn error', err);
          setError(err instanceof Error ? err.message : 'Turn failed');
          setStatus('idle');
        }
      }
    } catch (err) {
      console.error('[client] processTurn top error', err);
      setError('Error processing audio turn');
      setStatus('idle');
    }
  };

  const handleTurnResponse = async (data: any) => {
    if (!data) {
      setStatus('idle');
      setCanRequestSummary(true);
      return;
    }

    if (data.sessionEnded) {
      if (data.summary) {
        onSessionEnd(data.summary);
      } else {
        try {
          const resp = await fetch('/api/session/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: localSessionId }),
          });
          const j = await resp.json();
          onSessionEnd(j.summary);
        } catch (e) {
          setError('Failed to fetch summary');
          setStatus('idle');
        }
      }
      return;
    }

    if (data.audioBase64) {
      setStatus('speaking');
      try {
        console.log('[client] playing audio, base64 length:', data.audioBase64.length);

        // Use a Blob + object URL for more reliable playback
        const byteString = atob(data.audioBase64);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const objectUrl = URL.createObjectURL(blob);

        const audio = audioElementRef.current;
        if (!audio) {
          throw new Error('Audio element not available');
        }

        // Stop any current playback
        audio.pause();
        audio.currentTime = 0;

        audio.onended = () => {
          console.log('[client] audio ended');
          URL.revokeObjectURL(objectUrl);
          setStatus('idle');
          setCanRequestSummary(true);
        };

        audio.onerror = () => {
          console.error('[client] audio error, code:', audio.error?.code);
          URL.revokeObjectURL(objectUrl);
          setError('Failed to play response audio');
          setStatus('idle');
        };

        audio.src = objectUrl;
        audio.load();

        await audio.play();
        console.log('[client] audio playing');
      } catch (e) {
        console.error('[client] audio error:', e);
        setError('Failed to play response audio');
        setStatus('idle');
      }
    } else {
      setStatus('idle');
      setCanRequestSummary(true);
    }
  };

  const handleRequestSummary = async () => {
    try {
      setStatus('thinking');

      if (USE_PUTER) {
        const puter = await ensurePuterAuth();
        const convo = conversationHistory
          .map((m) => `${m.role === 'user' ? 'User' : 'Coach'}: ${m.content}`)
          .join('\n');

        const summaryPrompt = `Summarize this coaching session in 6–8 sentences. Include the user’s goal, key concerns, and 2–4 next steps.\n\nConversation:\n${convo}`;
        const resp = await puter.ai.chat(summaryPrompt, {
          model: 'gpt-5-nano',
        });
        const summary = normalizeAiResponse(extractPuterText(resp));
        onSessionEnd(summary);
        return;
      }

      const res = await fetch('/api/session/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: localSessionId }),
      });
      if (!res.ok) throw new Error('Summary request failed');
      const j = await res.json();
      onSessionEnd(j.summary);
    } catch (err) {
      console.error('[client] summary error', err);
      setError('Failed to generate summary');
      setStatus('idle');
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'listening':
        return 'Listening...';
      case 'thinking':
        return 'Thinking...';
      case 'speaking':
        return 'Speaking...';
      default:
        return 'Ready';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'listening':
        return 'bg-red-500';
      case 'thinking':
        return 'bg-yellow-500';
      case 'speaking':
        return 'bg-green-500';
      default:
        return 'bg-gray-400';
    }
  };

  const buildSystemPrompt = (userText: string) => {
    const traits = (selectedTraits || []).filter(Boolean);
    const traitsLine = traits.length ? `Preferred coaching traits: ${traits.join(', ')}.` : '';
    return [
      'You are a warm, practical coaching assistant.',
      traitsLine,
      `Respond in ${TARGET_MIN_WORDS}–${TARGET_MAX_WORDS} words, max 3 sentences, in complete sentences.`,
      'Be supportive, ask at least one reflective question, and avoid medical or legal advice.',
    ]
      .filter(Boolean)
      .join(' ');
  };

  return (
    <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
      {/* Hidden audio element for stable playback */}
      <audio ref={audioElementRef} preload="auto" />

      <h2 className="text-2xl font-bold text-gray-900 mb-6">Coaching Session</h2>

      <div className="mb-8">
        <div className={`w-32 h-32 mx-auto rounded-full ${getStatusColor()} flex items-center justify-center mb-4 transition-all`}>
          <span className="text-white text-sm font-semibold">{getStatusText()}</span>
        </div>
        <p className="text-gray-600 text-sm">{getStatusText()}</p>
      </div>

      {!micPermissionGranted && (
        <div className="mb-6 p-4 bg-blue-50 border-2 border-blue-300 rounded-lg">
          <p className="text-blue-900 text-sm mb-3 font-semibold">🎤 Enable Microphone to Start</p>
          <p className="text-blue-700 text-xs mb-3">Click the button below to enable microphone access. Your browser will ask for permission.</p>
          <button onClick={enableMicrophone} className="w-full px-6 py-3 bg-blue-600 text-white text-base font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-md">
            Enable Microphone
          </button>
        </div>
      )}

      {micPermissionGranted && (
        <div className="mb-4 p-2 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-700 text-sm">✓ Microphone enabled</p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-left">
          <p className="text-red-600 text-sm mb-2 font-semibold">{error}</p>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 text-left">
        <label className="text-xs text-gray-600">
          Voice language
          <select
            value={ttsLanguage}
            onChange={(e) => setTtsLanguage(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
          >
            {TTS_LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-600">
          Speech engine
          <select
            value={ttsEngine}
            onChange={(e) => setTtsEngine(e.target.value as 'standard' | 'neural' | 'generative')}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
          >
            {TTS_ENGINES.map((engine) => (
              <option key={engine} value={engine}>
                {engine.charAt(0).toUpperCase() + engine.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
        onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
        disabled={!micPermissionGranted || status === 'thinking' || status === 'speaking' || !!startingSessionRef.current}
        className={`
          w-full py-6 rounded-lg text-lg font-semibold transition-all mb-4
          ${!micPermissionGranted
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : isRecording
            ? 'bg-red-600 text-white hover:bg-red-700'
            : status === 'thinking' || status === 'speaking'
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-indigo-600 text-white hover:bg-indigo-700'
          } shadow-lg`}
      >
        {!micPermissionGranted ? 'Enable Microphone First' : isRecording ? 'Release to Send' : 'Hold to Speak'}
      </button>

      {canRequestSummary && (
        <button onClick={handleRequestSummary} disabled={status === 'thinking' || status === 'speaking'} className="w-full py-3 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all">
          Request Summary
        </button>
      )}
    </div>
  );
}
