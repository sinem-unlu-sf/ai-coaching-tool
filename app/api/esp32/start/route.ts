import { NextRequest, NextResponse } from 'next/server';
import { sessions, Session } from '../../session/store';

// ESP32 session start endpoint
// POST with JSON { traits: string[] }
// Returns JSON { sessionId: string }
export async function POST(request: NextRequest) {
  try {
    let traits: string[] = ['empathetic', 'encouraging'];

    try {
      const body = await request.json();
      if (Array.isArray(body.traits) && body.traits.length > 0) {
        traits = body.traits;
      }
    } catch {
      // Use defaults if no body or invalid JSON
    }

    const sessionId = `esp32_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    const session: Session = {
      sessionId,
      traits,
      conversationBuffer: [],
      goalTracking: {
        goalStated: false,
        motivationUnderstood: false,
        constraintsAcknowledged: false,
        nextStepsDefined: false,
      },
      turnCount: 0,
      createdAt: Date.now(),
    };

    sessions.set(sessionId, session);

    console.log('[ESP32] Session started:', sessionId, 'traits:', traits);

    return NextResponse.json({ sessionId });
  } catch (error) {
    console.error('[ESP32] Error starting session:', error);
    return NextResponse.json(
      { error: 'Failed to start session' },
      { status: 500 }
    );
  }
}
