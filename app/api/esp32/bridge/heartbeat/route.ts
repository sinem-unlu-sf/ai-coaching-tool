import { NextRequest, NextResponse } from 'next/server';
import {
  clearExpiredQueuedJobs,
  getBridgeStatus,
  markBridgeHeartbeat,
} from '../../bridge-store';

export async function POST(request: NextRequest) {
  try {
    let clientId = 'puter-bridge-browser';

    try {
      const body = await request.json();
      if (body?.clientId && typeof body.clientId === 'string') {
        clientId = body.clientId;
      }
    } catch {
      // Allow empty body heartbeats.
    }

    markBridgeHeartbeat(clientId);
    clearExpiredQueuedJobs();

    return NextResponse.json({ ok: true, ...getBridgeStatus() });
  } catch (error) {
    console.error('[ESP32 Bridge] Heartbeat error:', error);
    return NextResponse.json({ error: 'Heartbeat failed' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(getBridgeStatus());
}
