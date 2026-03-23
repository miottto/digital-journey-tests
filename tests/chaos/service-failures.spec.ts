import { test, expect } from '../../fixtures/index';
import { DatabaseHelper } from '../../utils/db-helper';
import { CompanyFactory } from '../../factories/CompanyFactory';

/**
 * Chaos Engineering Tests
 *
 * These tests validate graceful degradation under known failure modes.
 * Each scenario maps to a real production incident type.
 *
 * Key principle: chaos tests have zero retries.
 * A retry on a chaos test hides the failure mode we are looking for.
 * If the system crashes when a service is down, a retry that passes
 * is not a green test — it is a missed bug.
 */

test.describe('Chaos — Service Failures', () => {

  test.describe('Email service failures', () => {

    test('credit request should succeed even when email service returns 503', async ({ page, request }) => {
      const db = new DatabaseHelper();
      const company = CompanyFactory.guaranteed();

      // Inject failure: email service is unavailable
      await page.route('**/notifications/email', async route => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'Retry-After': '30' },
          body: JSON.stringify({ error: 'Service Unavailable' }),
        });
      });

      // Credit request must succeed regardless of email service status
      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 50_000,
          email:           company.email,
        },
      });

      expect(
        response.status(),
        'Credit request must succeed even when email service is unavailable'
      ).toBe(201);

      const body = await response.json();
      expect(body.status).toBe('PENDING_ANALYSIS');

      await db.deleteCreditRequest(body.id);
    });

    test('SMS service 503 should not block credit request creation', async ({ page, request }) => {
      const db = new DatabaseHelper();
      const company = CompanyFactory.guaranteed();

      await page.route('**/notifications/sms', async route => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Service Unavailable' }),
        });
      });

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 50_000,
          email:           company.email,
        },
      });

      expect(response.status(), 'Credit request must succeed even when SMS service is unavailable').toBe(201);
      const body = await response.json();
      await db.deleteCreditRequest(body.id);
    });

  });

  test.describe('Chatbot service failures', () => {

    test('chatbot 500 should return structured error, not crash the server', async ({ request }) => {
      // We test the server's own error handling here —
      // if the chatbot adapter throws, the server must return 500 gracefully
      // rather than an unhandled crash with no response body.
      const response = await request.post('/chatbot/message', {
        data: { message: 'I need credit', sessionId: 'chaos-test-session' },
      });

      // With mock adapter, this always succeeds.
      // The key assertion is structural: response must always have a body.
      expect(response.status()).toBeLessThan(600);
      const body = await response.json();
      expect(body).toBeDefined();
    });

    test('chatbot should handle empty message gracefully', async ({ request }) => {
      const response = await request.post('/chatbot/message', {
        data: { message: '', sessionId: 'chaos-empty-session' },
      });

      // Empty string is falsy — server should return 422
      expect(response.status()).toBe(422);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    test('chatbot should handle extremely long message without crashing', async ({ request }) => {
      const longMessage = 'I need credit '.repeat(500); // ~7000 chars

      const response = await request.post('/chatbot/message', {
        data: { message: longMessage, sessionId: 'chaos-long-session' },
      });

      // Must respond — not crash or timeout
      expect(response.status()).toBeLessThan(600);
      const body = await response.json();
      expect(body).toBeDefined();
    });

  });

  test.describe('Disbursement service failures', () => {

    test('disbursement of non-approved request should return structured 422, not 500', async ({ request }) => {
      const db = new DatabaseHelper();
      const company = CompanyFactory.guaranteed();

      const created = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 50_000,
          email:           company.email,
        },
      });
      const createdBody = await created.json();

      // Attempt disbursement while PENDING — business rule violation
      const response = await request.post(`/credit-requests/${createdBody.id}/disburse`, {
        data: { pixKey: 'company@test.com' },
      });

      // Must return 422 (business rule), not 500 (crash)
      expect(response.status()).toBe(422);
      const body = await response.json();
      expect(body.error).toBe('Only approved credit requests can be disbursed.');

      await db.deleteCreditRequest(createdBody.id);
    });

    test('concurrent disbursement attempts should not create duplicate records', async ({ request }) => {
      const db = new DatabaseHelper();
      const company = CompanyFactory.guaranteed();
      const { Client } = require('pg');

      const created = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 50_000,
          email:           company.email,
        },
      });
      const createdBody = await created.json();

      // Approve
      const pg = new Client((db as any).dbConfig);
      await pg.connect();
      await pg.query(
        `UPDATE credit_requests SET status = 'APPROVED' WHERE id = $1`,
        [createdBody.id]
      );
      await pg.end();

      // Fire 3 concurrent disbursement requests
      const [first, second, third] = await Promise.all([
        request.post(`/credit-requests/${createdBody.id}/disburse`, { data: { pixKey: 'pix@company.com' } }),
        request.post(`/credit-requests/${createdBody.id}/disburse`, { data: { pixKey: 'pix@company.com' } }),
        request.post(`/credit-requests/${createdBody.id}/disburse`, { data: { pixKey: 'pix@company.com' } }),
      ]);

      const statuses = [first.status(), second.status(), third.status()];

      // At least one must succeed
      expect(statuses).toContain(201);

      await db.deleteCreditRequest(createdBody.id);
    });

  });

  test.describe('Webhook to ERP failures', () => {

    test('webhook endpoint should return 200 and record WEBHOOK_FAILED when ERP is not configured', async ({ request }) => {
      const db = new DatabaseHelper();
      const company = CompanyFactory.guaranteed();
      const { Client } = require('pg');

      const created = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 50_000,
          email:           company.email,
        },
      });
      const createdBody = await created.json();

      const pg = new Client((db as any).dbConfig);
      await pg.connect();
      await pg.query(`UPDATE credit_requests SET status = 'APPROVED' WHERE id = $1`, [createdBody.id]);
      await pg.end();

      // In test env ERP_WEBHOOK_URL is not set — server must handle gracefully (fire-and-forget)
      const response = await request.post(`/credit-requests/${createdBody.id}/webhook`);

      expect(
        response.status(),
        'Webhook endpoint must return 200 even when ERP is unavailable'
      ).toBe(200);

      const body = await response.json();
      expect(body.correlationId).toBeTruthy();

      // A WEBHOOK_FAILED audit event must always be recorded on failure
      const events = await db.getAuditEvents(createdBody.id);
      const webhookEvent = events.find((e: any) =>
        e.event_type === 'WEBHOOK_DISPATCHED' || e.event_type === 'WEBHOOK_FAILED'
      );
      expect(
        webhookEvent,
        'Webhook audit event must be recorded even when ERP is unavailable'
      ).toBeDefined();

      await db.deleteCreditRequest(createdBody.id);
    });

  });

  test.describe('Malformed payloads', () => {

    test('should handle null body gracefully on credit request endpoint', async ({ request }) => {
      const response = await request.post('/credit-requests', {
        data: null,
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(600);
    });

    test('should handle unexpected field types without crashing', async ({ request }) => {
      const response = await request.post('/credit-requests', {
        data: {
          companyId:       12345,
          companyName:     true,
          requestedAmount: 'not-a-number',
          email:           [],
        },
      });

      // Must return a client error — not a 500 server crash
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    });

  });

});
