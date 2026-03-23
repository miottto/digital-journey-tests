import { test, expect } from '../../fixtures/index';

test.describe('Chatbot Journey', () => {

  test('should identify REQUEST_CREDIT intent', async ({ request }) => {
    const response = await request.post('/chatbot/message', {
      data: { message: 'I need a credit line for my company', sessionId: 'test-session-1' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.intent).toBe('REQUEST_CREDIT');
    expect(body.confidence).toBeGreaterThan(0.8);
    expect(body.reply).toBeTruthy();
    expect(body.correlationId).toBeTruthy();
  });

  test('should identify TRACK_REQUEST intent', async ({ request }) => {
    const response = await request.post('/chatbot/message', {
      data: { message: 'I want to track the status of my request', sessionId: 'test-session-2' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.intent).toBe('TRACK_REQUEST');
    expect(body.confidence).toBeGreaterThan(0.8);
  });

  test('should identify SPEAK_TO_HUMAN intent', async ({ request }) => {
    const response = await request.post('/chatbot/message', {
      data: { message: 'I want to speak to a human agent', sessionId: 'test-session-3' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.intent).toBe('SPEAK_TO_HUMAN');
    expect(body.confidence).toBeGreaterThan(0.8);
  });

  test('should identify OUT_OF_SCOPE intent for unrelated messages', async ({ request }) => {
    const response = await request.post('/chatbot/message', {
      data: { message: 'What is the weather like today?', sessionId: 'test-session-4' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.intent).toBe('OUT_OF_SCOPE');
    expect(body.reply).toBeTruthy();
  });

  test('should return 422 when message is missing', async ({ request }) => {
    const response = await request.post('/chatbot/message', {
      data: { sessionId: 'test-session-5' },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('message is required.');
  });

  test('should generate a sessionId when not provided', async ({ request }) => {
    const response = await request.post('/chatbot/message', {
      data: { message: 'I need financing for my business' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.intent).toBe('REQUEST_CREDIT');
    expect(body.correlationId).toBeTruthy();
  });

  test('should carry correlationId through chatbot response', async ({ request }) => {
    const testCorrelationId = `chatbot-test-${Date.now()}`;

    const response = await request.post('/chatbot/message', {
      headers: { 'x-correlation-id': testCorrelationId },
      data: { message: 'I need a loan', sessionId: 'test-correlation-session' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.correlationId).toBe(testCorrelationId);
    expect(response.headers()['x-correlation-id']).toBe(testCorrelationId);
  });

  test('should collect companyId from message when provided', async ({ request }) => {
    const response = await request.post('/chatbot/message', {
      data: {
        message: 'My company ID is ACME12345678',
        sessionId: 'test-collect-session',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.collectedData).toBeDefined();
    expect(body.intent).toBe('REQUEST_CREDIT');
  });

});
