import { sendToAgent, AgentResponse } from './agent';

export class ChatbotAdapter {
  private useReal: boolean;

  constructor() {
    this.useReal = process.env.USE_AI_AGENT === 'true';
    console.log(`[Chatbot] Adapter: ${this.useReal ? 'Gemini ADK (real)' : 'Mock (deterministic)'}`);
  }

  async send(message: string, sessionId: string): Promise<AgentResponse> {
    if (this.useReal) return sendToAgent(message, sessionId);
    return this.mockResponse(message);
  }

  private mockResponse(message: string): AgentResponse {
    const lower = message.toLowerCase();

    if (lower.includes('credit') || lower.includes('loan') || lower.includes('financing') || lower.includes('apply') || lower.includes('capital')) {
      return {
        intent: 'REQUEST_CREDIT',
        confidence: 0.95,
        reply: "I'd be happy to help with your credit application. Please provide your company ID to get started.",
        collectedData: { companyId: null, requestedAmount: null, purpose: null },
      };
    }
    if (lower.includes('track') || lower.includes('status') || lower.includes('my request') || lower.includes('follow up')) {
      return {
        intent: 'TRACK_REQUEST',
        confidence: 0.92,
        reply: 'Sure! Please provide your request ID and I will look that up for you.',
        collectedData: { companyId: null, requestedAmount: null, purpose: null },
      };
    }
    if (lower.includes('human') || lower.includes('agent') || lower.includes('representative') || lower.includes('speak to someone')) {
      return {
        intent: 'SPEAK_TO_HUMAN',
        confidence: 0.97,
        reply: 'Understood. Let me connect you with one of our specialists. Please hold on.',
        collectedData: { companyId: null, requestedAmount: null, purpose: null },
      };
    }
    const companyIdMatch = message.match(/\b[A-Z0-9]{8,14}\b/);
    if (companyIdMatch) {
      return {
        intent: 'REQUEST_CREDIT',
        confidence: 0.88,
        reply: `Got it — company ID ${companyIdMatch[0]} noted. What is the credit amount you are looking for?`,
        collectedData: { companyId: companyIdMatch[0], requestedAmount: null, purpose: null },
      };
    }
    return {
      intent: 'OUT_OF_SCOPE',
      confidence: 0.85,
      reply: 'I can only assist with business credit requests. How can I help you with that?',
      collectedData: { companyId: null, requestedAmount: null, purpose: null },
    };
  }
}
