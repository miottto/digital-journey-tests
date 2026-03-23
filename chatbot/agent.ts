import 'dotenv/config';
import { LlmAgent, Runner, InMemorySessionService } from '@google/adk';

const SYSTEM_PROMPT = `
You are the virtual assistant for a B2B digital credit platform.
Your role is to qualify credit requests from business clients via conversation.

Always respond in English.
Always return a JSON object with this exact structure:
{
  "intent": "REQUEST_CREDIT" | "TRACK_REQUEST" | "SPEAK_TO_HUMAN" | "OUT_OF_SCOPE",
  "confidence": number between 0 and 1,
  "reply": "your friendly and professional response to the user",
  "collectedData": {
    "companyId": string | null,
    "requestedAmount": number | null,
    "purpose": string | null
  }
}

Rules:
- If the user mentions a company ID or tax ID, extract it into collectedData.companyId
- If the user mentions an amount, extract it into collectedData.requestedAmount
- If the message has no relation to business credit, use intent OUT_OF_SCOPE
- confidence must reflect your certainty about the identified intent
- reply must always be concise and professional
`.trim();

let agentInstance: LlmAgent | null = null;
let runnerInstance: Runner | null = null;
const sessionService = new InMemorySessionService();

function getAgent(): { agent: LlmAgent; runner: Runner } {
  if (!agentInstance || !runnerInstance) {
    agentInstance = new LlmAgent({
      name: 'credit_qualification_agent',
      model: 'gemini-3.0-flash',
      description: 'Qualifies B2B credit requests via conversation',
      instruction: SYSTEM_PROMPT,
    });
    runnerInstance = new Runner({
      agent: agentInstance,
      appName: 'digital-journey',
      sessionService,
    });
  }
  return { agent: agentInstance, runner: runnerInstance };
}

export const rootAgent = (() => {
  const { agent } = getAgent();
  return agent;
})();

export interface AgentResponse {
  intent: 'REQUEST_CREDIT' | 'TRACK_REQUEST' | 'SPEAK_TO_HUMAN' | 'OUT_OF_SCOPE';
  confidence: number;
  reply: string;
  collectedData: {
    companyId: string | null;
    requestedAmount: number | null;
    purpose: string | null;
  };
}

export async function sendToAgent(message: string, sessionId: string): Promise<AgentResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
  process.env.GOOGLE_API_KEY = apiKey;
  const { runner } = getAgent();
  const userMessage = { role: 'user' as const, parts: [{ text: message }] };
  let fullText = '';
  for await (const event of runner.runAsync({ userId: 'journey-user', sessionId, newMessage: userMessage })) {
    if (event.content?.parts) {
      for (const part of event.content.parts) {
        if ('text' in part) fullText += part.text;
      }
    }
  }
  const cleaned = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      intent:        parsed.intent        ?? 'OUT_OF_SCOPE',
      confidence:    parsed.confidence    ?? 0,
      reply:         parsed.reply         ?? fullText,
      collectedData: parsed.collectedData ?? { companyId: null, requestedAmount: null, purpose: null },
    };
  } catch {
    return {
      intent: 'OUT_OF_SCOPE',
      confidence: 0.1,
      reply: fullText || 'Sorry, I could not process your message. Please try again.',
      collectedData: { companyId: null, requestedAmount: null, purpose: null },
    };
  }
}

// ADK Web and CLI entrypoint
// Run with: npx adk web (from project root)
// or:       npx adk run chatbot/agent.ts
export default rootAgent;
