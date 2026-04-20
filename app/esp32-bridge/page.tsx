'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    puter?: any;
  }
}

type BridgeJob = {
  id: string;
  sessionId: string;
  audioBase64: string;
  mimeType: string;
  traits: string[];
  conversationHistory: Array<{ role: string; content: string }>;
  goalTracking: {
    goalStated: boolean;
    motivationUnderstood: boolean;
    constraintsAcknowledged: boolean;
    nextStepsDefined: boolean;
  };
  turnCount: number;
};

const PUTER_SCRIPT_ID = 'puter-js-sdk';
const BRIDGE_CLIENT_ID = 'puter-bridge-browser';
const POLL_INTERVAL_MS = 800;
const HEARTBEAT_INTERVAL_MS = 5000;
const CHAT_MODEL = 'gemini-2.5-flash-lite';
const USE_COMPUTER_MIC_INPUT = false;
const COMPUTER_MIC_CAPTURE_MS = 4200;
const STT_TIMEOUT_MS = 14000;
const CHAT_TIMEOUT_MS = 16000;
const BROWSER_TTS_TIMEOUT_MS = 16000;
const BROWSER_TTS_DOWNLOAD_TIMEOUT_MS = 8000;

const loadPuterScript = () =>
  new Promise<void>((resolve, reject) => {
    if (window.puter) {
      resolve();
      return;
    }

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
  if (!window.puter) {
    throw new Error('Puter.js not available');
  }
  return window.puter;
};

const ensurePuterAuth = async () => {
  const puter = await getPuter();
  try {
    const signedIn = await puter.auth.isSignedIn();
    if (!signedIn) {
      await puter.auth.signIn();
    }
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

function extractPuterAudioSrc(response: any): string {
  if (typeof response === 'string') return response;
  if (typeof response?.src === 'string') return response.src;
  if (typeof response?.audio?.src === 'string') return response.audio.src;
  if (typeof response?.url === 'string') return response.url;
  if (typeof response?.audioUrl === 'string') return response.audioUrl;
  return '';
}

function normalizeText(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (/[.!?]$/.test(cleaned)) return cleaned;
  return `${cleaned}.`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
  }

  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes.charCodeAt(i);
  }
  return new Blob([out.buffer], { type: mimeType });
}

function base64ToBytes(base64: string): Uint8Array {
  const bytes = atob(base64);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes.charCodeAt(i);
  }
  return out;
}

function buildPcmWavBlob(
  pcmBytes: Uint8Array,
  sampleRate = 16000,
  channels = 1,
  bitsPerSample = 16
): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBytes.byteLength;

  view.setUint32(0, 0x52494646, false); // RIFF
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // WAVE
  view.setUint32(12, 0x666d7420, false); // fmt 
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); // data
  view.setUint32(40, dataSize, true);

  const pcmCopy = new Uint8Array(pcmBytes.byteLength);
  pcmCopy.set(pcmBytes);
  return new Blob([header, pcmCopy], { type: 'audio/wav' });
}

function readPcmSampleAsFloat(view: DataView, offset: number, bitsPerSample: number): number {
  if (bitsPerSample === 8) {
    const u = view.getUint8(offset);
    return (u - 128) / 128;
  }
  if (bitsPerSample === 16) {
    return view.getInt16(offset, true) / 32768;
  }
  if (bitsPerSample === 24) {
    const b0 = view.getUint8(offset);
    const b1 = view.getUint8(offset + 1);
    const b2 = view.getUint8(offset + 2);
    let value = b0 | (b1 << 8) | (b2 << 16);
    if (value & 0x800000) {
      value |= ~0xffffff;
    }
    return value / 8388608;
  }
  if (bitsPerSample === 32) {
    return view.getInt32(offset, true) / 2147483648;
  }
  return 0;
}

function convertPcmChunkToCanonicalWav(
  bytes: Uint8Array,
  dataOffset: number,
  dataLength: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Blob {
  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  if (bytesPerSample <= 0 || frameSize <= 0 || dataLength < frameSize) {
    return buildPcmWavBlob(bytes.slice(dataOffset, dataOffset + dataLength), 16000, 1, 16);
  }

  const usableLength = Math.floor(dataLength / frameSize) * frameSize;
  const frames = usableLength / frameSize;
  if (frames <= 0) {
    return buildPcmWavBlob(bytes.slice(dataOffset, dataOffset + dataLength), 16000, 1, 16);
  }

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + dataOffset,
    usableLength
  );

  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const off = i * frameSize + ch * bytesPerSample;
      sum += readPcmSampleAsFloat(view, off, bitsPerSample);
    }
    mono[i] = sum / channels;
  }

  // Remove DC bias and lightly gate near-silence hiss before transcription.
  let dc = 0;
  for (let i = 0; i < mono.length; i++) dc += mono[i];
  dc /= mono.length;
  for (let i = 0; i < mono.length; i++) {
    let v = mono[i] - dc;
    if (Math.abs(v) < 0.006) v = 0;
    mono[i] = v;
  }

  const safeRate = sampleRate >= 8000 && sampleRate <= 48000 ? sampleRate : 16000;
  const mono16k = downsampleLinear(mono, safeRate, 16000);
  const pcm16 = float32ToPcm16Bytes(mono16k);
  return buildPcmWavBlob(pcm16, 16000, 1, 16);
}

function normalizeEsp32Wav(base64: string, mimeType: string): Blob {
  const bytes = base64ToBytes(base64);
  if (bytes.length < 32) {
    return buildPcmWavBlob(bytes, 16000, 1, 16);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readChunkId = (offset: number) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

  const hasRiffWave =
    readChunkId(0) === 'RIFF' &&
    readChunkId(8) === 'WAVE';

  if (!hasRiffWave) {
    // Fallback for raw PCM payloads.
    return buildPcmWavBlob(bytes, 16000, 1, 16);
  }

  let audioFormat = 1;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = readChunkId(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkDataOffset + 16 <= bytes.length) {
      audioFormat = view.getUint16(chunkDataOffset, true) || 1;
      channels = view.getUint16(chunkDataOffset + 2, true) || 1;
      sampleRate = view.getUint32(chunkDataOffset + 4, true) || 16000;
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true) || 16;
    } else if (chunkId === 'data' && chunkDataOffset <= bytes.length) {
      dataOffset = chunkDataOffset;
      dataLength = Math.min(chunkSize, bytes.length - chunkDataOffset);
      break;
    }

    const paddedChunkSize = chunkSize + (chunkSize % 2);
    const nextOffset = chunkDataOffset + paddedChunkSize;
    if (nextOffset <= offset || nextOffset > bytes.length) {
      break;
    }
    offset = nextOffset;
  }

  if (dataOffset < 0 || dataLength <= 0) {
    return buildPcmWavBlob(bytes, 16000, 1, 16);
  }

  const supportedPcm =
    audioFormat === 1 &&
    (channels === 1 || channels === 2) &&
    (bitsPerSample === 8 || bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32);

  if (!supportedPcm) {
    // As a last resort, pass through the full WAV unchanged.
    const rawCopy = new Uint8Array(bytes.byteLength);
    rawCopy.set(bytes);
    return new Blob([rawCopy], { type: mimeType || 'audio/wav' });
  }

  return convertPcmChunkToCanonicalWav(
    bytes,
    dataOffset,
    dataLength,
    sampleRate,
    channels,
    bitsPerSample
  );
}

function downsampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = input[idx] ?? 0;
    const b = input[Math.min(idx + 1, input.length - 1)] ?? a;
    output[i] = a + (b - a) * frac;
  }

  return output;
}

function float32ToPcm16Bytes(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2);
  const view = new DataView(out.buffer);

  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    const v = s < 0 ? s * 32768 : s * 32767;
    view.setInt16(i * 2, v, true);
  }

  return out;
}

async function captureComputerMicBlob(durationMs: number): Promise<Blob> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Browser microphone API unavailable');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  let selectedMime = '';
  for (const candidate of candidates) {
    if ((window as any).MediaRecorder?.isTypeSupported?.(candidate)) {
      selectedMime = candidate;
      break;
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    let recorder: MediaRecorder;
    try {
      recorder = selectedMime ? new MediaRecorder(stream, { mimeType: selectedMime }) : new MediaRecorder(stream);
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      reject(error);
      return;
    }

    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop());
      reject(new Error('Microphone recording failed'));
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!chunks.length) {
        reject(new Error('No microphone audio captured'));
        return;
      }
      resolve(new Blob(chunks, { type: recorder.mimeType || selectedMime || 'audio/webm' }));
    };

    recorder.start(200);
    setTimeout(() => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    }, durationMs);
  });
}

async function captureComputerMicWav(durationMs: number): Promise<Blob> {
  const recordedBlob = await captureComputerMicBlob(durationMs);
  const rawBuffer = await recordedBlob.arrayBuffer();

  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('AudioContext unavailable for mic conversion');
  }

  const audioContext = new AudioContextCtor();
  try {
    const decoded = await audioContext.decodeAudioData(rawBuffer.slice(0));
    const source = decoded.getChannelData(0);
    const mono16k = downsampleLinear(source, decoded.sampleRate, 16000);
    const pcm16 = float32ToPcm16Bytes(mono16k);
    return buildPcmWavBlob(pcm16, 16000, 1, 16);
  } finally {
    await audioContext.close();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function buildCoachingPromptFromJob(job: BridgeJob, userText: string): string {
  const traits = job.traits || [];
  const goalTracking = job.goalTracking || {
    goalStated: false,
    motivationUnderstood: false,
    constraintsAcknowledged: false,
    nextStepsDefined: false,
  };

  const traitTone: Record<string, string> = {
    empathetic: 'warm and understanding',
    encouraging: 'supportive and positive',
    calm: 'serene and measured',
    challenging: 'provocative but respectful',
    reflective: 'curious and reflective',
    analytical: 'clear and analytical',
    'big-picture': 'future-focused and visionary',
    tactical: 'practical and concrete',
    structured: 'organized and step-by-step',
    exploratory: 'open-ended and discovery-driven',
    'goal-driven': 'focused and outcomes-oriented',
    'action-oriented': 'decisive and action-focused',
    directive: 'direct and concise',
    'question-led': 'question-centric and curious',
    'framework-based': 'framework-informed but conversational',
    'intuition-based': 'intuitive and flexible',
  };

  const tone = traits
    .map(t => traitTone[t])
    .filter(Boolean)
    .slice(0, 2)
    .join(' + ') || 'supportive and practical';

  const historyText = (job.conversationHistory || [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Coach'}: ${m.content}`)
    .join('\n');

  const recentCoachText = (job.conversationHistory || [])
    .filter((m) => m.role !== 'user')
    .slice(-2)
    .map((m, idx) => `${idx + 1}. ${m.content}`)
    .join('\n');

  const shouldEndSession =
    goalTracking.goalStated &&
    goalTracking.motivationUnderstood &&
    goalTracking.nextStepsDefined &&
    job.turnCount >= 3;

  return `
You are a voice-based AI coach helping users clarify career or academic goals and create actionable next steps.

COACHING PRINCIPLES:
1. Reflect before advising.
2. Keep responses clear and focused.
3. Give 2-4 concrete next steps when appropriate.
4. Ask clarifying questions until the goal is clearly stated.
5. Gently redirect off-topic discussion back to career/academic goals.
6. Keep the total session around 4-5 turns.

STYLE:
- Tone: ${tone}
- Traits: ${traits.join(', ') || 'none'}

GOAL TRACKING (internal):
- Goal clearly stated: ${goalTracking.goalStated ? 'YES' : 'NO'}
- Motivation understood: ${goalTracking.motivationUnderstood ? 'YES' : 'NO'}
- Constraints acknowledged: ${goalTracking.constraintsAcknowledged ? 'YES' : 'NO'}
- Next steps defined: ${goalTracking.nextStepsDefined ? 'YES' : 'NO'}

CONVERSATION HISTORY:
${historyText || 'No previous conversation'}

CURRENT USER MESSAGE: ${userText}

RECENT COACH RESPONSES (avoid repeating wording from these):
${recentCoachText || 'None yet'}

${shouldEndSession
  ? `FINAL RESPONSE MODE:
- Signal closure naturally.
- Summarize the user's goal in plain language.
- Give 2-3 concrete next steps in sentence form (no bullet list).
- End with short encouragement.
- Keep it concise: 4-6 sentences, around 70-120 words.
- Do not reuse sentence openings or stock phrases from recent coach responses.`
  : `NORMAL RESPONSE MODE:
- Respond like a real human coach in live conversation.
- Use natural spoken language with contractions.
- Vary sentence length and rhythm.
- Acknowledge the user's point briefly, then add one useful insight or practical next move.
- Ask at most one question, and only if it helps move the conversation.
- Avoid generic praise, avoid list formatting, and avoid repeating wording from recent coach responses.
- Keep it concise: 4-7 complete sentences, around 60-110 words.
- Output only spoken-style response text.`}
`;
}

export default function Esp32BridgePage() {
  const [signedIn, setSignedIn] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [jobsHandled, setJobsHandled] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const puterRef = useRef<any>(null);
  const runningRef = useRef(false);
  const busyRef = useRef(false);

  const sendHeartbeat = useCallback(async () => {
    await fetch('/api/esp32/bridge/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: BRIDGE_CLIENT_ID }),
    });
  }, []);

  const submitResult = useCallback(async (jobId: string, payload: any) => {
    const response = await fetch(`/api/esp32/bridge/job/${encodeURIComponent(jobId)}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`submitResult failed (${response.status}): ${body.slice(0, 180)}`);
    }
  }, []);

  const processJob = useCallback(async (job: BridgeJob) => {
    const puter = puterRef.current;
    if (!puter) throw new Error('Puter is not ready');

    let audioFile: File;
    if (USE_COMPUTER_MIC_INPUT) {
      setStatus('Listening on computer mic...');
      const capturedWav = await withTimeout(
        captureComputerMicWav(COMPUTER_MIC_CAPTURE_MS),
        COMPUTER_MIC_CAPTURE_MS + 9000,
        'Computer mic capture'
      );
      audioFile = new File([capturedWav], 'computer-mic.wav', { type: 'audio/wav' });
    } else {
      const wavBlob = normalizeEsp32Wav(job.audioBase64, job.mimeType || 'audio/wav');
      audioFile = new File([wavBlob], 'esp32-turn.wav', { type: 'audio/wav' });
    }

    setStatus('Transcribing audio...');

    let sttResponse: any;
    try {
      sttResponse = await withTimeout(
        puter.ai.speech2txt(audioFile, { model: 'gpt-4o-mini-transcribe' }),
        STT_TIMEOUT_MS,
        'STT'
      );
    } catch {
      sttResponse = await withTimeout(
        puter.ai.speech2txt({ file: audioFile, model: 'gpt-4o-mini-transcribe' }),
        STT_TIMEOUT_MS,
        'STT'
      );
    }

    const userText = (sttResponse?.text || sttResponse || '').toString().trim();
    if (!userText) {
      await submitResult(job.id, { error: 'No speech detected' });
      return;
    }

    setStatus('Generating coaching response...');
    const prompt = buildCoachingPromptFromJob(job, userText);
    const chatResponse = await withTimeout(
      puter.ai.chat(prompt, { model: CHAT_MODEL }),
      CHAT_TIMEOUT_MS,
      'Chat'
    );
    const aiText = normalizeText(extractPuterText(chatResponse));

    if (!aiText) {
      await submitResult(job.id, { error: 'Empty AI response' });
      return;
    }

    setStatus('Preparing response audio...');

    // Generate browser-side backup audio so hardware can play reliably.
    let backupAudioBase64 = '';
    try {
      setStatus('Generating backup voice...');
      const audioElement = await withTimeout(
        puter.ai.txt2speech(aiText, {
          engine: 'neural',
          language: 'en-US',
        }),
        BROWSER_TTS_TIMEOUT_MS,
        'Backup TTS'
      );

      const audioSrc = extractPuterAudioSrc(audioElement);
      if (audioSrc) {
        const audioResp = await withTimeout(
          fetch(audioSrc),
          BROWSER_TTS_DOWNLOAD_TIMEOUT_MS,
          'Backup TTS download'
        );
        const audioBuf = await audioResp.arrayBuffer();
        backupAudioBase64 = arrayBufferToBase64(audioBuf);
      }
    } catch (err) {
      console.warn('Backup browser TTS generation failed:', err);
    }

    await submitResult(job.id, {
      userText,
      aiText,
      audioBase64: backupAudioBase64 || undefined,
    });
  }, [submitResult]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    if (!running || !signedIn) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || !runningRef.current || busyRef.current) return;
      busyRef.current = true;

      try {
        await sendHeartbeat();

        const res = await fetch('/api/esp32/bridge/job', { cache: 'no-store' });
        if (res.status === 204) {
          setStatus('Waiting for ESP32...');
          return;
        }

        if (!res.ok) {
          throw new Error(`Job poll failed (${res.status})`);
        }

        const job = (await res.json()) as BridgeJob;
        try {
          await processJob(job);
          setJobsHandled((v) => v + 1);
          setLastError(null);
          setStatus('Waiting for ESP32...');
        } catch (error) {
          const msg = errorMessage(error);
          await submitResult(job.id, { error: msg }).catch(() => {
            // no-op; poll loop will continue and server timeout remains fallback
          });
          setLastError(msg);
          setStatus('Bridge error');
        }
      } catch (error) {
        const msg = errorMessage(error);
        setLastError(msg);
        setStatus('Bridge error');
      } finally {
        busyRef.current = false;
      }
    };

    const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    const heartbeatTimer = setInterval(() => {
      sendHeartbeat().catch(() => {
        // no-op, poll loop surfaces any recurring errors
      });
    }, HEARTBEAT_INTERVAL_MS);

    // Run immediately so first turn does not wait for interval.
    poll().catch(() => {
      // no-op
    });

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
    };
  }, [running, signedIn, processJob, sendHeartbeat]);

  const handleSignIn = async () => {
    try {
      setStatus('Signing in to Puter...');
      const puter = await ensurePuterAuth();
      puterRef.current = puter;
      setSignedIn(true);
      setLastError(null);
      setStatus('Signed in. Ready to run bridge.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Puter sign-in failed';
      setLastError(msg);
      setStatus('Sign-in failed');
    }
  };

  const handleStartBridge = async () => {
    if (!signedIn) {
      await handleSignIn();
      return;
    }

    setRunning(true);
    setLastError(null);
    setStatus('Starting bridge...');
  };

  const handleStopBridge = () => {
    setRunning(false);
    setStatus('Bridge stopped');
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-6">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl">
        <h1 className="text-2xl font-bold tracking-tight">ESP32 Puter Bridge</h1>
        <p className="mt-2 text-sm text-slate-300">
          Keep this page open while using hardware mode. ESP32 sends audio to your local server,
          this bridge processes STT + coaching + TTS with Puter and returns playable audio.
        </p>

        <div className="mt-6 grid gap-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-sm">
          <div>Status: <span className="font-semibold">{status}</span></div>
          <div>Puter signed in: <span className="font-semibold">{signedIn ? 'Yes' : 'No'}</span></div>
          <div>Bridge running: <span className="font-semibold">{running ? 'Yes' : 'No'}</span></div>
          <div>Input source: <span className="font-semibold">{USE_COMPUTER_MIC_INPUT ? 'Computer mic' : 'ESP32 audio upload'}</span></div>
          <div>Speech engine: <span className="font-semibold">Puter bridge TTS</span></div>
          <div>Jobs handled: <span className="font-semibold">{jobsHandled}</span></div>
          {lastError && <div className="text-rose-300">Last error: {lastError}</div>}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={handleSignIn}
            className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400"
          >
            {signedIn ? 'Re-check Puter Login' : 'Sign In to Puter'}
          </button>

          {!running ? (
            <button
              onClick={handleStartBridge}
              className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Start Bridge
            </button>
          ) : (
            <button
              onClick={handleStopBridge}
              className="rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-300"
            >
              Stop Bridge
            </button>
          )}
        </div>

        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-xs text-slate-300">
          <p>Run order:</p>
          <p>1. Start Next.js server.</p>
          <p>2. Open this page and click Sign In to Puter.</p>
          <p>3. Click Start Bridge.</p>
          <p>4. Use ESP32 push-to-talk hardware as usual.</p>
        </div>
      </div>
    </main>
  );
}
