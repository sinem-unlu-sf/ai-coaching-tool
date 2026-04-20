import { NextRequest, NextResponse } from 'next/server';
import { markBridgeHeartbeat, submitBridgeResult } from '../../../../bridge-store';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const jobId = params.id;
    if (!jobId) {
      return NextResponse.json({ error: 'Missing job ID' }, { status: 400 });
    }

    const body = await request.json();
    const accepted = submitBridgeResult(jobId, {
      userText: body?.userText,
      aiText: body?.aiText,
      audioBase64: body?.audioBase64,
      voiceId: body?.voiceId,
      error: body?.error,
    });

    markBridgeHeartbeat('puter-bridge-browser');

    if (!accepted) {
      return NextResponse.json({ error: 'Job not found or already resolved' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[ESP32 Bridge] Submit result error:', error);
    return NextResponse.json({ error: 'Failed to submit result' }, { status: 500 });
  }
}
