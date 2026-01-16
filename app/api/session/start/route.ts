import { NextRequest, NextResponse } from 'next/server';
import { sessions, Session } from '../store';

export async function POST(request: NextRequest) {
  try {
    const { traits } = await request.json();

    if (!Array.isArray(traits) || traits.length === 0) {
      return NextResponse.json(
        { error: 'At least one trait must be selected' },
        { status: 400 }
      );
    }

    // Generate session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // Initialize session state
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

    return NextResponse.json({ sessionId });
  } catch (error) {
    console.error('Error starting session:', error);
    return NextResponse.json(
      { error: 'Failed to start session' },
      { status: 500 }
    );
  }
}

