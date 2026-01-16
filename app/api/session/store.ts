// In-memory session store (ephemeral)
// Sessions are destroyed when they end or expire
export const sessions = new Map<string, any>();

// Separate audio storage by ID
export const audioStore = new Map<string, Buffer>();

// Session type definition
export interface Session {
  sessionId: string;
  traits: string[];
  conversationBuffer: Array<{ role: string; content: string }>;
  goalTracking: {
    goalStated: boolean;
    motivationUnderstood: boolean;
    constraintsAcknowledged: boolean;
    nextStepsDefined: boolean;
  };
  turnCount: number;
  createdAt: number;
}

