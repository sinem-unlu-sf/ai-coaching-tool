import { NextRequest, NextResponse } from 'next/server';
import { sessions } from '../store';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function generateSummary(session: any): Promise<string> {
  if (!GEMINI_API_KEY) {
    return 'Summary generation unavailable - API key not configured';
  }

  const conversationText = session.conversationBuffer
    .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Coach'}: ${msg.content}`)
    .join('\n\n');

  const summaryPrompt = `Based on this coaching conversation, generate a concise written summary (3-4 paragraphs) that includes:
1. The user's clarified goal
2. Key insights discussed
3. 2-4 concrete action steps

Conversation:
${conversationText}

Summary:`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: summaryPrompt }],
          }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 500,
          },
        }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Summary unavailable';
    } else {
      console.error('Summary generation failed:', await response.text());
    }
  } catch (error) {
    console.error('Error generating summary:', error);
  }

  return 'Summary generation failed. Please try again.';
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      );
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    const summary = await generateSummary(session);
    
    // Clean up session after summary is generated
    sessions.delete(sessionId);

    return NextResponse.json({ summary });
  } catch (error) {
    console.error('Error generating summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}

