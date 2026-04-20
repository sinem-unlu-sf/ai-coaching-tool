// Shared coaching logic used by both web and ESP32 endpoints

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

const RETRYABLE_GEMINI_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callGeminiWithRetry(
  body: any,
  purpose: string,
  attempts = 3
): Promise<any> {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');

  let lastStatus = 0;
  let lastErrorText = '';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (response.ok) {
      return response.json();
    }

    lastStatus = response.status;
    lastErrorText = await response.text();

    if (!RETRYABLE_GEMINI_STATUS.has(response.status) || attempt === attempts) {
      console.error(`Gemini ${purpose} error:`, { status: lastStatus, error: lastErrorText });
      throw new Error(`${purpose} failed (${lastStatus})`);
    }

    // Exponential backoff for temporary Gemini capacity/rate-limit spikes.
    await sleep(500 * Math.pow(2, attempt - 1));
  }

  throw new Error(`${purpose} failed (${lastStatus}): ${lastErrorText}`);
}

interface PersonalityTrait {
  id: string;
  tone?: string;
  questionRatio?: number;
  structureLevel?: string;
  frameworkUsage?: boolean;
  pacing?: string;
}

export function buildCoachingPrompt(
  userMessage: string,
  traits: string[],
  conversationHistory: Array<{ role: string; content: string }>,
  goalTracking: any,
  turnCount: number
): string {
  const traitBehaviors: Record<string, PersonalityTrait> = {
    empathetic: { id: 'empathetic', tone: 'warm and understanding', questionRatio: 0.6 },
    encouraging: { id: 'encouraging', tone: 'supportive and positive', questionRatio: 0.5 },
    calm: { id: 'calm', tone: 'serene and measured', pacing: 'slow' },
    challenging: { id: 'challenging', tone: 'provocative but respectful', questionRatio: 0.7 },
    reflective: { id: 'reflective', questionRatio: 0.8, structureLevel: 'low' },
    analytical: { id: 'analytical', structureLevel: 'high', frameworkUsage: true },
    'big-picture': { id: 'big-picture', structureLevel: 'low', pacing: 'slow' },
    tactical: { id: 'tactical', structureLevel: 'high', pacing: 'fast' },
    structured: { id: 'structured', structureLevel: 'high', frameworkUsage: true },
    exploratory: { id: 'exploratory', structureLevel: 'low', questionRatio: 0.8 },
    'goal-driven': { id: 'goal-driven', structureLevel: 'high', pacing: 'fast' },
    'action-oriented': { id: 'action-oriented', pacing: 'fast', questionRatio: 0.3 },
    directive: { id: 'directive', questionRatio: 0.2, pacing: 'fast' },
    'question-led': { id: 'question-led', questionRatio: 0.9 },
    'framework-based': { id: 'framework-based', frameworkUsage: true, structureLevel: 'high' },
    'intuition-based': { id: 'intuition-based', structureLevel: 'low', questionRatio: 0.7 },
  };

  const combinedBehavior = traits.reduce((acc, traitId) => {
    const behavior = traitBehaviors[traitId];
    if (behavior) {
      acc.tone = acc.tone || behavior.tone;
      acc.questionRatio = (acc.questionRatio || 0) + (behavior.questionRatio || 0.5);
      acc.structureLevel = acc.structureLevel || behavior.structureLevel || 'medium';
      acc.frameworkUsage = acc.frameworkUsage || behavior.frameworkUsage || false;
      acc.pacing = acc.pacing || behavior.pacing || 'medium';
    }
    return acc;
  }, {} as PersonalityTrait);

  const avgQuestionRatio = combinedBehavior.questionRatio
    ? combinedBehavior.questionRatio / traits.length
    : 0.5;
  const tone = combinedBehavior.tone || 'supportive and professional';
  const structureLevel = combinedBehavior.structureLevel || 'medium';
  const canUseFrameworks = combinedBehavior.frameworkUsage || false;
  const pacing = combinedBehavior.pacing || 'medium';

  const historyText = conversationHistory
    .slice(-6)
    .map(msg => `${msg.role === 'user' ? 'User' : 'Coach'}: ${msg.content}`)
    .join('\n');

  const recentCoachText = conversationHistory
    .filter(msg => msg.role !== 'user')
    .slice(-2)
    .map((msg, idx) => `${idx + 1}. ${msg.content}`)
    .join('\n');

  const shouldEndSession =
    goalTracking.goalStated &&
    goalTracking.motivationUnderstood &&
    goalTracking.nextStepsDefined &&
    turnCount >= 3;

  return `
You are a voice-based AI coach helping users clarify career or academic goals and create actionable next steps.

COACHING PRINCIPLES:
1. Reflect before advising - Always acknowledge what the user said before offering guidance
2. Avoid overwhelming - Keep responses clear and focused
3. Limit action steps - Provide 2-4 concrete next steps 
4. Ask clarifying questions - Until the goal is clearly stated
5. Gently redirect - Keep focus on career/academic goals
6. Maintain flexibility - Scope is moderately flexible but centered on goals
7. Take a total of 4-5 turns maximum and end the conversation with a summary and next steps
PERSONALITY TRAITS (${traits.join(', ')}):
- Tone: ${tone}
- Question-to-advice ratio: ${(avgQuestionRatio * 100).toFixed(0)}% questions, ${((1 - avgQuestionRatio) * 100).toFixed(0)}% advice
- Structure level: ${structureLevel}
- Framework usage: ${canUseFrameworks ? 'allowed' : 'avoid formal frameworks'}
- Pacing: ${pacing}

GOAL TRACKING CHECKLIST (internal only, never mention to user):
- Goal clearly stated: ${goalTracking.goalStated ? 'YES' : 'NO'}
- Motivation understood: ${goalTracking.motivationUnderstood ? 'YES' : 'NO'}
- Constraints acknowledged: ${goalTracking.constraintsAcknowledged ? 'YES' : 'NO'}
- Next steps defined: ${goalTracking.nextStepsDefined ? 'YES' : 'NO'}

CONVERSATION HISTORY:
${historyText || 'No previous conversation'}

CURRENT USER MESSAGE: ${userMessage}

RECENT COACH RESPONSES (avoid repeating wording from these):
${recentCoachText || 'None yet'}

INSTRUCTIONS:
${shouldEndSession
    ? `This is the FINAL response. The session should end. You MUST:
1. Signal closure naturally.
2. Summarize the user's goal in plain language.
3. Give 2-3 concrete next steps in sentence form (no bullet list).
4. End with short encouragement.
5. Keep it concise: 4-6 sentences, around 70-120 words.
6. Do not reuse sentence openings or stock phrases from recent coach responses.`
  : `Respond like a real human coach in live conversation. Use ${avgQuestionRatio > 0.6 ? 'mostly questions' : avgQuestionRatio < 0.4 ? 'mostly advice' : 'a balanced mix of questions and advice'}.
1. Use natural spoken language with contractions.
2. Vary sentence length and rhythm.
3. Acknowledge the user's point briefly, then add one useful insight or practical next move.
4. Ask at most one question, and only if it helps move the conversation.
5. Avoid generic praise, avoid list formatting, and avoid repeating wording from recent coach responses.
6. Keep it concise: 4-7 complete sentences, around 60-110 words.
7. Output only the response text.`}

IMPORTANT: Your response will be converted to speech. Write naturally as if speaking, not writing.
`;
}

export function updateGoalTracking(
  userMessage: string,
  aiResponse: string,
  currentTracking: any
): any {
  const lowerMessage = userMessage.toLowerCase();
  const lowerResponse = aiResponse.toLowerCase();

  const goalKeywords = ['goal', 'want to', 'aim to', 'plan to', 'hope to', 'dream'];
  const motivationKeywords = ['because', 'motivated', 'interested', 'passion', 'excited'];
  const constraintKeywords = ['but', 'however', 'limited', 'constraint', 'challenge', 'difficulty'];
  const actionKeywords = ['next step', 'action', 'do', 'will', 'plan', 'task'];

  return {
    goalStated: currentTracking.goalStated || goalKeywords.some(kw => lowerMessage.includes(kw)),
    motivationUnderstood: currentTracking.motivationUnderstood ||
      motivationKeywords.some(kw => lowerMessage.includes(kw)) ||
      (currentTracking.goalStated && lowerResponse.includes('understand')),
    constraintsAcknowledged: currentTracking.constraintsAcknowledged ||
      constraintKeywords.some(kw => lowerMessage.includes(kw)),
    nextStepsDefined: currentTracking.nextStepsDefined ||
      actionKeywords.some(kw => lowerResponse.includes(kw)),
  };
}

export function normalizeAiResponse(text: string): string {
  let t = text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_`>#-]+/g, ' ')
    .replace(/[•·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (t && !/[.!?]$/.test(t)) {
    t += '.';
  }
  return t;
}

export function looksTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const tail = t.split(/\s+/).slice(-3).join(' ').toLowerCase();
  return /(and|but|because|so|or|with|to|of|that|which|who|i|we|you)\.?$/.test(tail);
}

export function sanitizeForTTS(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_`>#-]+/g, ' ')
    .replace(/[•·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function generateLLMText(
  prompt: string,
  temperature = 0.7,
  maxOutputTokens = 400
): Promise<string> {
  const llmData = await callGeminiWithRetry(
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens },
    },
    'LLM',
    3
  );

  return llmData.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType: string
): Promise<string> {
  const sttData = await callGeminiWithRetry(
    {
      contents: [{
        parts: [{
          inline_data: { mime_type: mimeType, data: audioBase64 },
        }, {
          text: 'Transcribe this audio. Return only the transcribed text, nothing else.',
        }],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
    },
    'STT',
    3
  );

  return sttData.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function generateTTSAudio(
  text: string,
  voiceIdOverride?: string
): Promise<Buffer> {
  const apiKey = process.env.SMALLEST_API_KEY || process.env.SMALLESTAI_API_KEY;
  const configuredVoiceId = process.env.SMALLEST_VOICE_ID || 'daniel';
  const fallbackVoiceIds = ['daniel', 'alex', 'rachel'];
  const minExpectedAudioBytes = 3000;

  if (!apiKey) {
    throw new Error('SMALLEST_KEY_MISSING');
  }

  const ttsText = sanitizeForTTS(text);

  const candidateVoiceIds = Array.from(new Set([
    voiceIdOverride?.trim(),
    configuredVoiceId.trim(),
    ...fallbackVoiceIds,
  ].filter(Boolean) as string[]));

  let lastError = 'SMALLEST_EMPTY_AUDIO';

  for (const voiceId of candidateVoiceIds) {
    const response = await fetch('https://api.smallest.ai/waves/v1/lightning-v3.1/get_speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: ttsText,
        voice_id: voiceId,
        sample_rate: 24000,
        speed: 1,
        language: 'en',
        output_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      console.error('Smallest TTS error:', { status: response.status, voiceId, bodyText });

      if (response.status === 401) {
        throw new Error('SMALLEST_AUTH_FAILED');
      }
      if (response.status === 429) {
        throw new Error('SMALLEST_RATE_LIMIT');
      }

      const lower = bodyText.toLowerCase();
      if (lower.includes('voice') && (lower.includes('invalid') || lower.includes('not found'))) {
        lastError = 'SMALLEST_VOICE_INVALID';
        continue;
      }

      lastError = `SMALLEST_HTTP_${response.status}`;
      continue;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    let audioBuffer: Buffer | null = null;

    if (contentType.includes('application/json')) {
      const json: any = await response.json();
      const encoded =
        json?.audio_base64 ||
        json?.audioBase64 ||
        json?.base64 ||
        json?.data ||
        json?.audio;

      if (typeof encoded === 'string' && encoded.trim()) {
        const cleaned = encoded.includes(',') ? encoded.split(',').pop() || encoded : encoded;
        audioBuffer = Buffer.from(cleaned, 'base64');
      } else {
        const audioUrl = json?.audio_url || json?.audioUrl || json?.url;
        if (typeof audioUrl === 'string' && audioUrl.startsWith('http')) {
          const audioResp = await fetch(audioUrl);
          if (audioResp.ok) {
            audioBuffer = Buffer.from(await audioResp.arrayBuffer());
          } else {
            lastError = `SMALLEST_AUDIO_URL_HTTP_${audioResp.status}`;
            continue;
          }
        }
      }
    } else {
      audioBuffer = Buffer.from(await response.arrayBuffer());
    }

    if (audioBuffer && audioBuffer.length >= minExpectedAudioBytes) {
      return audioBuffer;
    }

    // Smallest may return tiny placeholder audio on unsupported voices.
    console.warn('Smallest returned tiny audio, trying fallback voice', {
      voiceId,
      bytes: audioBuffer ? audioBuffer.length : 0,
    });
    lastError = 'SMALLEST_EMPTY_AUDIO';
  }

  throw new Error(lastError);
}

export async function generateSummary(session: any): Promise<string> {
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
          contents: [{ parts: [{ text: summaryPrompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 500 },
        }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Summary unavailable';
    }
  } catch (error) {
    console.error('Error generating summary:', error);
  }

  return 'Summary generation failed. Please try again.';
}
