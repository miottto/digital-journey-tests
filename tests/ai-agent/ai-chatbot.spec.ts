import { test, expect } from '@playwright/test';
import { newSession, sendMessage } from '../../helpers/adkHelper';

test.describe('AI Chatbot — Gemini Agent', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8000');
    await page.waitForTimeout(2000);
    await newSession(page);
  });

  test('@ai-agent should identify REQUEST_CREDIT intent', async ({ page }) => {
    const response = await sendMessage(page, 'I need a credit line for my company');
    expect(response.intent).toBe('REQUEST_CREDIT');
    expect(response.confidence).toBeGreaterThan(0.7);
    expect(response.reply).toBeTruthy();
  });

  test('@ai-agent should identify TRACK_REQUEST intent', async ({ page }) => {
    const response = await sendMessage(page, 'I want to check the status of my credit request');
    expect(response.intent).toBe('TRACK_REQUEST');
    expect(response.confidence).toBeGreaterThan(0.7);
  });

  test('@ai-agent should identify SPEAK_TO_HUMAN intent', async ({ page }) => {
    const response = await sendMessage(page, 'I want to talk to a human agent please');
    expect(response.intent).toBe('SPEAK_TO_HUMAN');
    expect(response.confidence).toBeGreaterThan(0.7);
  });

  test('@ai-agent should identify OUT_OF_SCOPE intent', async ({ page }) => {
    const response = await sendMessage(page, 'What is the weather like in São Paulo today?');
    expect(response.intent).toBe('OUT_OF_SCOPE');
    expect(response.reply).toBeTruthy();
  });

  test('@ai-agent should collect companyId from message', async ({ page }) => {
    const response = await sendMessage(page, 'My company ID is ACME12345678 and I need R$50000 in credit');
    expect(response.intent).toBe('REQUEST_CREDIT');
    expect(response.collectedData).toBeDefined();
  });

  test('@ai-agent should handle ambiguous message gracefully', async ({ page }) => {
    const response = await sendMessage(page, 'I have a question about something');
    expect(response).toHaveProperty('intent');
    expect(response).toHaveProperty('confidence');
    expect(typeof response.confidence).toBe('number');
    expect(response.confidence).toBeGreaterThanOrEqual(0);
    expect(response.confidence).toBeLessThanOrEqual(1);
  });

  test('@ai-agent should maintain context across messages in same session', async ({ page }) => {
    const first = await sendMessage(page, 'I need financing for my business');
    expect(first.intent).toBe('REQUEST_CREDIT');

    const second = await sendMessage(page, 'The amount I need is R$75000');
    expect(second.collectedData).toBeDefined();
  });

  test('@ai-agent should respond in valid JSON format for any input', async ({ page }) => {
    const response = await sendMessage(page, 'asdfghjkl random text 12345');
    expect(response).toHaveProperty('intent');
    expect(response).toHaveProperty('confidence');
    expect(response).toHaveProperty('reply');
    expect(typeof response.confidence).toBe('number');
  });

});
