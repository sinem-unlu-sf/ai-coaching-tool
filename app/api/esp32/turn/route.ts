import { NextRequest, NextResponse } from 'next/server';
import { sessions } from '../../session/store';
import {
  updateGoalTracking,
  normalizeAiResponse,
} from '../../shared/coaching';
import {
  enqueueBridgeJob,
  isBridgeOnline,
} from '../bridge-store';

// ESP32 turn endpoint
// POST with raw WAV body
// Headers: X-Session-Id
// Returns: raw MP3 audio bytes
// Response Headers: X-Session-Ended, X-Response-Text
export async function POST(request: NextRequest) {
  try {
    const sessionId = request.headers.get('x-session-id');
    if (!sessionId) {
      return new NextResponse('Missing X-Session-Id header', { status: 400 });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return new NextResponse('Session not found', { status: 404 });
    }

    // Step 1: Read raw WAV audio from request body
    const audioBuffer = await request.arrayBuffer();
    if (audioBuffer.byteLength < 44) {
      return new NextResponse('Audio too short', { status: 400 });
    }

    console.log('[ESP32] Received audio:', audioBuffer.byteLength, 'bytes');

    if (!isBridgeOnline()) {
      return new NextResponse('Puter bridge offline', { status: 503 });
    }

    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    // Step 2: Send turn to the browser Puter bridge (STT + LLM + TTS)
    let bridgeResult: {
      userText?: string;
      aiText?: string;
      audioBase64?: string;
      voiceId?: string;
      error?: string;
    };
    try {
      bridgeResult = await enqueueBridgeJob({
        sessionId,
        audioBase64,
        mimeType: 'audio/wav',
        traits: session.traits,
        conversationHistory: session.conversationBuffer.slice(-8),
        goalTracking: session.goalTracking,
        turnCount: session.turnCount + 1,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ESP32] Bridge error:', message);
      if (message.includes('BRIDGE_OFFLINE')) {
        return new NextResponse('Puter bridge offline', { status: 503 });
      }
      if (message.includes('BRIDGE_TIMEOUT')) {
        return new NextResponse('Puter bridge timeout', { status: 504 });
      }
      return new NextResponse('Bridge processing failed', { status: 500 });
    }

    if (bridgeResult.error) {
      const errorText = bridgeResult.error.toLowerCase();

      if (errorText.includes('timeout') || errorText.includes('timed out')) {
        return new NextResponse(bridgeResult.error, { status: 504 });
      }

      if (errorText.includes('rate') || errorText.includes('429')) {
        return new NextResponse(bridgeResult.error, { status: 429 });
      }

      if (
        errorText.includes('busy') ||
        errorText.includes('overload') ||
        errorText.includes('503')
      ) {
        return new NextResponse(bridgeResult.error, { status: 503 });
      }

      if (
        errorText.includes('corrupted') ||
        errorText.includes('unsupported') ||
        errorText.includes('bad audio') ||
        errorText.includes('audio file')
      ) {
        return new NextResponse(bridgeResult.error, { status: 400 });
      }

      return new NextResponse(bridgeResult.error, { status: 500 });
    }

    const userMessage = (bridgeResult.userText || '').trim();
    const aiResponseRaw = (bridgeResult.aiText || '').trim();
    const bridgeAudioBase64 = (bridgeResult.audioBase64 || '').trim();

    if (!userMessage) {
      return new NextResponse('No speech detected', { status: 400 });
    }

    if (!aiResponseRaw) {
      return new NextResponse('AI response was empty', { status: 500 });
    }

    const aiResponse = normalizeAiResponse(aiResponseRaw);
    let audioResponseBuffer: Buffer | null = null;

    // Use bridge-generated TTS audio (Puter).
    if (bridgeAudioBase64) {
      try {
        const fallbackBuffer = Buffer.from(bridgeAudioBase64, 'base64');
        if (fallbackBuffer.length >= 200) {
          audioResponseBuffer = fallbackBuffer;
        }
      } catch (fallbackErr) {
        console.error('[ESP32] Bridge audio decode failed:', fallbackErr);
      }
    }

    if (!audioResponseBuffer) {
      return new NextResponse('Puter TTS unavailable right now.', { status: 503 });
    }

    if (audioResponseBuffer.length < 200) {
      return new NextResponse('TTS audio too short', { status: 500 });
    }

    // Step 3: update session
    session.conversationBuffer.push({ role: 'user', content: userMessage });
    session.turnCount += 1;
    session.goalTracking = updateGoalTracking(userMessage, aiResponse, session.goalTracking);
    session.conversationBuffer.push({ role: 'assistant', content: aiResponse });

    // Step 4: check if session should end
    const shouldEndSession =
      session.goalTracking.goalStated &&
      session.goalTracking.motivationUnderstood &&
      session.goalTracking.nextStepsDefined &&
      session.turnCount >= 3;

    console.log('[ESP32] MP3 response:', audioResponseBuffer.length, 'bytes, sessionEnded:', shouldEndSession);

    // Step 5: clean up if session ended
    if (shouldEndSession) {
      sessions.delete(sessionId);
    }

    // Step 6: return raw MP3 bytes with metadata headers
    return new NextResponse(new Uint8Array(audioResponseBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioResponseBuffer.length.toString(),
        'X-Session-Ended': shouldEndSession ? 'true' : 'false',
        'X-Response-Text': encodeURIComponent(aiResponse.substring(0, 500)),
      },
    });
  } catch (error) {
    console.error('[ESP32] Error processing turn:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
