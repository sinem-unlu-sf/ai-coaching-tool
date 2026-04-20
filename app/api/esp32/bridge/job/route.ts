import { NextResponse } from 'next/server';
import { claimNextBridgeJob, markBridgeHeartbeat } from '../../bridge-store';

export async function GET() {
  // Polling itself counts as heartbeat from active browser bridge.
  markBridgeHeartbeat('puter-bridge-browser');

  const job = claimNextBridgeJob();
  if (!job) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json(job);
}
