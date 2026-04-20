import { randomUUID } from 'crypto';

type Message = { role: string; content: string };

export interface BridgeTurnJob {
  id: string;
  createdAt: number;
  sessionId: string;
  audioBase64: string;
  mimeType: string;
  traits: string[];
  conversationHistory: Message[];
  goalTracking: {
    goalStated: boolean;
    motivationUnderstood: boolean;
    constraintsAcknowledged: boolean;
    nextStepsDefined: boolean;
  };
  turnCount: number;
}

export interface BridgeTurnResult {
  userText?: string;
  aiText?: string;
  audioBase64?: string;
  voiceId?: string;
  error?: string;
}

const queuedJobs: BridgeTurnJob[] = [];
const pendingResolvers = new Map<string, (result: BridgeTurnResult) => void>();

const bridgeState = {
  active: false,
  lastHeartbeatAt: 0,
  clientId: 'unknown',
};

const BRIDGE_ONLINE_WINDOW_MS = 15000;

export function markBridgeHeartbeat(clientId = 'puter-bridge-browser') {
  bridgeState.active = true;
  bridgeState.lastHeartbeatAt = Date.now();
  bridgeState.clientId = clientId;
}

export function isBridgeOnline(maxIdleMs = BRIDGE_ONLINE_WINDOW_MS): boolean {
  if (!bridgeState.active) return false;
  return Date.now() - bridgeState.lastHeartbeatAt <= maxIdleMs;
}

export function getBridgeStatus() {
  return {
    online: isBridgeOnline(),
    active: bridgeState.active,
    clientId: bridgeState.clientId,
    lastHeartbeatAt: bridgeState.lastHeartbeatAt,
    queuedJobs: queuedJobs.length,
    pendingJobs: pendingResolvers.size,
  };
}

export function claimNextBridgeJob(): BridgeTurnJob | null {
  if (queuedJobs.length === 0) return null;
  return queuedJobs.shift() || null;
}

export function submitBridgeResult(jobId: string, result: BridgeTurnResult): boolean {
  const resolver = pendingResolvers.get(jobId);
  if (!resolver) return false;

  pendingResolvers.delete(jobId);
  resolver(result);
  return true;
}

export function clearExpiredQueuedJobs(maxAgeMs = 180000) {
  const cutoff = Date.now() - maxAgeMs;
  for (let i = queuedJobs.length - 1; i >= 0; i--) {
    if (queuedJobs[i].createdAt < cutoff) {
      queuedJobs.splice(i, 1);
    }
  }
}

export async function enqueueBridgeJob(
  payload: Omit<BridgeTurnJob, 'id' | 'createdAt'>,
  timeoutMs = 63000
): Promise<BridgeTurnResult> {
  if (!isBridgeOnline()) {
    throw new Error('BRIDGE_OFFLINE');
  }

  const job: BridgeTurnJob = {
    ...payload,
    id: randomUUID(),
    createdAt: Date.now(),
  };

  queuedJobs.push(job);

  return new Promise<BridgeTurnResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResolvers.delete(job.id);
      reject(new Error('BRIDGE_TIMEOUT'));
    }, timeoutMs);

    pendingResolvers.set(job.id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}
