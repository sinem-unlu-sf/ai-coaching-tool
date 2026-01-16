import { NextRequest, NextResponse } from 'next/server';
import { sessions, Session, audioStore } from '../store';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default voice

interface PersonalityTrait {
  id: string;
  tone?: string;
  questionRatio?: number;
  structureLevel?: string;
  frameworkUsage?: boolean;
  pacing?: string;
}

function buildCoachingPrompt(
  userMessage: string,
  traits: string[],
  conversationHistory: Array<{ role: string; content: string }>,
  goalTracking: any,
  turnCount: number
): string {
  // Personality trait mappings
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

  // Determine combined behavior from selected traits
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

  // Build conversation history string
  const historyText = conversationHistory
    .slice(-6) // Last 6 exchanges
    .map(msg => `${msg.role === 'user' ? 'User' : 'Coach'}: ${msg.content}`)
    .join('\n');

  // Determine if session should end
  const shouldEndSession = 
    goalTracking.goalStated &&
    goalTracking.motivationUnderstood &&
    goalTracking.nextStepsDefined &&
    turnCount >= 3; // Minimum 3 turns

  const systemRules = `
You are a voice-based AI coach helping users clarify career or academic goals and create actionable next steps.

COACHING PRINCIPLES:
1. Reflect before advising - Always acknowledge what the user said before offering guidance
2. Avoid overwhelming - Keep responses clear and focused
3. Limit action steps - Provide 2-4 concrete next steps 
4. Ask clarifying questions - Until the goal is clearly stated
5. Gently redirect - Keep focus on career/academic goals
6. Maintain flexibility - Scope is moderately flexible but centered on goals

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

INSTRUCTIONS:
${shouldEndSession 
  ? `This is the FINAL response. The session should end. You MUST:
1. Explicitly signal closure ("Before we wrap up..." or similar)
2. Summarize the user's goal clearly
3. List 2-4 concrete next steps
4. Offer a written summary
5. Keep it concise (3-4 sentences total)`
  : `Respond naturally as a coach. Use ${avgQuestionRatio > 0.6 ? 'mostly questions' : avgQuestionRatio < 0.4 ? 'mostly advice' : 'a balance of questions and advice'}. 
Aim for 120–180 words and 5–8 complete sentences. Include at least one reflective question. Do not use fragments. Output only the response text.`}

IMPORTANT: Your response will be converted to speech. Write naturally as if speaking, not writing.
`;

  return systemRules;
}

function updateGoalTracking(
  userMessage: string,
  aiResponse: string,
  currentTracking: any
): any {
  const lowerMessage = userMessage.toLowerCase();
  const lowerResponse = aiResponse.toLowerCase();

  // Simple heuristics to update goal tracking
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const sessionId = formData.get('sessionId') as string;

    if (!audioFile || !sessionId) {
      return NextResponse.json(
        { error: 'Missing audio file or session ID' },
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

    // Step 1: Transcribe audio using Gemini STT
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'Gemini API key not configured' },
        { status: 500 }
      );
    }

    const audioBuffer = await audioFile.arrayBuffer();
    const sttAudioBase64 = Buffer.from(audioBuffer).toString('base64');

    // Determine the correct MIME type based on the uploaded file
    let audioMimeType = audioFile.type || 'audio/webm';
    
    // Normalize MIME types that Gemini expects
    if (audioMimeType.includes('webm')) {
      audioMimeType = 'audio/webm'; // Gemini prefers base type without codec specs
    }

    let userMessage: string;
    try {
      console.log('[server] STT request:', {
        audioSize: audioBuffer.byteLength,
        mimeType: audioMimeType,
        fileName: audioFile.name,
      });
      const sttResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                inline_data: {
                  mime_type: audioMimeType,
                  data: sttAudioBase64,
                },
              }, {
                text: 'Transcribe this audio. Return only the transcribed text, nothing else.',
              }],
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 500,
            },
          }),
        }
      );

      if (!sttResponse.ok) {
        const errorText = await sttResponse.text();
        console.error('Gemini STT error:', {
          status: sttResponse.status,
          statusText: sttResponse.statusText,
          error: errorText,
          audioSize: audioBuffer.byteLength,
          mimeType: audioMimeType,
        });
        return NextResponse.json(
          { error: `STT failed (${sttResponse.status}): ${errorText.substring(0, 100)}` },
          { status: 500 }
        );
      }

      const sttData = await sttResponse.json();
      console.log('[server] STT response:', JSON.stringify(sttData).substring(0, 500));
      
      userMessage = sttData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!userMessage.trim()) {
        console.warn('No speech detected in audio. Full response:', JSON.stringify(sttData));
        return NextResponse.json(
          { error: 'No speech detected in audio. Please try speaking again.' },
          { status: 400 }
        );
      }
      
      console.log('[server] transcribed user message:', userMessage);
    } catch (error) {
      console.error('STT error:', error);
      return NextResponse.json(
        { error: 'Failed to process audio. Please try again.' },
        { status: 500 }
      );
    }

    // Step 2: Update conversation buffer
    session.conversationBuffer.push({ role: 'user', content: userMessage });
    session.turnCount += 1;

    // Step 3: Build coaching prompt
    const prompt = buildCoachingPrompt(
      userMessage,
      session.traits,
      session.conversationBuffer,
      session.goalTracking,
      session.turnCount
    );

    // Step 4: Call Gemini LLM
    let aiResponse: string;
    try {
      aiResponse = await generateLLMText(prompt, 0.7, 500);

      const needsRepair = (text: string) => {
        const wc = text.trim().split(/\s+/).filter(Boolean).length;
        return wc < 90 || looksTruncated(text) || !/[.!?]$/.test(text.trim());
      };

      if (needsRepair(aiResponse)) {
        const repairPrompt = `Rewrite the following coaching response so it is 120–180 words and composed of complete, well‑formed sentences. Keep the same meaning and tone. Do not add new topics. Include at least one reflective question. Avoid fragments.\n\nResponse:\n${aiResponse}`;
        aiResponse = await generateLLMText(repairPrompt, 0.5, 500);
      }

      if (needsRepair(aiResponse)) {
        const regenPrompt = `${prompt}\n\nIMPORTANT: You MUST output 120–180 words in 5–8 complete sentences with at least one reflective question. No fragments. Output only the response text.`;
        aiResponse = await generateLLMText(regenPrompt, 0.4, 600);
      }

      aiResponse = normalizeAiResponse(aiResponse);
      console.log('[server] AI response text:', aiResponse);

      if (!aiResponse.trim()) {
        return NextResponse.json(
          { error: 'AI response was empty. Please try again.' },
          { status: 500 }
        );
      }
    } catch (error) {
      console.error('LLM error:', error);
      return NextResponse.json(
        { error: 'Failed to generate response. Please try again.' },
        { status: 500 }
      );
    }

    // Step 5: Update goal tracking
    session.goalTracking = updateGoalTracking(userMessage, aiResponse, session.goalTracking);
    session.conversationBuffer.push({ role: 'assistant', content: aiResponse });

    // Step 6: Check if session should end
    const shouldEndSession = 
      session.goalTracking.goalStated &&
      session.goalTracking.motivationUnderstood &&
      session.goalTracking.nextStepsDefined &&
      session.turnCount >= 3;

    // Step 7: Generate audio and return as base64
    let audioBase64: string | null = null;
    
    if (ELEVENLABS_API_KEY) {
      try {
        const ttsText = sanitizeForTTS(aiResponse);

        const ttsResponse = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
          {
            method: 'POST',
            headers: {
              'Accept': 'audio/mpeg',
              'Content-Type': 'application/json',
              'xi-api-key': ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
              text: ttsText,
              model_id: 'eleven_turbo_v2',
              output_format: 'mp3_44100_128',
              optimize_streaming_latency: 0,
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
              },
            }),
          }
        );

        if (ttsResponse.ok) {
          const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
          audioBase64 = audioBuffer.toString('base64');
          console.log('[server] Audio generated:', { size: audioBuffer.length, base64Size: audioBase64.length });
        } else {
          const errorText = await ttsResponse.text();
          console.error('ElevenLabs TTS error:', { status: ttsResponse.status, errorText });
        }
      } catch (ttsError) {
        console.error('TTS error:', ttsError);
      }
    }

    // Step 8: Return response
    if (shouldEndSession) {
      // Generate summary before ending
      const summary = await generateSummary(session);
      sessions.delete(sessionId); // Clean up session
      
      return NextResponse.json({
        sessionEnded: true,
        audioBase64,
        response: aiResponse,
        summary,
      });
    }

    return NextResponse.json({
      sessionEnded: false,
      audioBase64,
      response: aiResponse,
    });
  } catch (error) {
    console.error('Error processing turn:', error);
    return NextResponse.json(
      { error: 'Failed to process turn' },
      { status: 500 }
    );
  }
}

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

function sanitizeForTTS(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_`>#-]+/g, ' ') // remove markdown-ish chars
    .replace(/[•·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoChunks(text: string, maxChars = 600): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    const next = (current ? current + ' ' : '') + s;
    if (next.length > maxChars && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current = next;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function normalizeAiResponse(text: string): string {
  let t = text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_`>#-]+/g, ' ')
    .replace(/[•·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Ensure it ends with punctuation
  if (t && !/[.!?]$/.test(t)) {
    t += '.';
  }
  return t;
}

function looksTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // ends with a weak word/conjunction (likely cut off)
  const tail = t.split(/\s+/).slice(-3).join(' ').toLowerCase();
  return /(and|but|because|so|or|with|to|of|that|which|who|i|we|you)\.?$/.test(tail);
}

async function generateLLMText(prompt: string, temperature = 0.7, maxOutputTokens = 400): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');

  const llmResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature,
          maxOutputTokens,
        },
      }),
    }
  );

  if (!llmResponse.ok) {
    const errorText = await llmResponse.text();
    console.error('Gemini LLM error:', errorText);
    throw new Error('LLM request failed');
  }

  const llmData = await llmResponse.json();
  return llmData.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

