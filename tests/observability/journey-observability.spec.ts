import { test, expect } from '../../fixtures/index';
import { DatabaseHelper } from '../../utils/db-helper';
import { CompanyFactory } from '../../factories/CompanyFactory';

/**
 * Observability Tests
 *
 * These tests validate WHEN and HOW things happen, not just IF they happen.
 *
 * Three concerns:
 * 1. SLA — each step completes within its defined time contract
 * 2. Correlation ID — single ID propagates through every layer
 * 3. Audit trail — every state transition is recorded, ordered, complete
 */

test.describe('Observability — Digital Journey', () => {

  test.describe('SLA validation', () => {

    test('credit request creation should complete within SLA (2000ms)', async ({ request }) => {
      const company = CompanyFactory.guaranteed();
      const db = new DatabaseHelper();

      const start = performance.now();

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 50_000,
          email:           company.email,
        },
      });

      const durationMs = Math.round(performance.now() - start);
      const SLA_MS = 2_000;

      expect(response.status()).toBe(201);
      expect(
        durationMs,
        `SLA BREACH: credit request creation took ${durationMs}ms, expected ≤ ${SLA_MS}ms`
      ).toBeLessThanOrEqual(SLA_MS);

      const body = await response.json();
      await db.deleteCreditRequest(body.id);
    });

    test('chatbot response should complete within SLA (10000ms)', async ({ request }) => {
      const start = performance.now();

      const response = await request.post('/chatbot/message', {
        data: { message: 'I need a credit line', sessionId: 'sla-test-session' },
      });

      const durationMs = Math.round(performance.now() - start);
      const SLA_MS = 10_000;

      expect(response.status()).toBe(200);
      expect(
        durationMs,
        `SLA BREACH: chatbot response took ${durationMs}ms, expected ≤ ${SLA_MS}ms`
      ).toBeLessThanOrEqual(SLA_MS);
    });

    test('email notification should complete within SLA (2000ms)', async ({ request }) => {
      const db = new DatabaseHelper();
      const correlationId = `sla-email-${Date.now()}`;
      const start = performance.now();

      const response = await request.post('/notifications/email', {
        headers: { 'x-correlation-id': correlationId },
        data: { to: 'test@company.com', subject: 'SLA test' },
      });

      const durationMs = Math.round(performance.now() - start);
      const SLA_MS = 2_000;

      expect(response.status()).toBe(200);
      expect(
        durationMs,
        `SLA BREACH: email notification took ${durationMs}ms, expected ≤ ${SLA_MS}ms`
      ).toBeLessThanOrEqual(SLA_MS);

      await db.deleteNotificationsByCorrelationId(correlationId);
    });

    test('SMS notification should complete within SLA (2000ms)', async ({ request }) => {
      const db = new DatabaseHelper();
      const correlationId = `sla-sms-${Date.now()}`;
      const start = performance.now();

      const response = await request.post('/notifications/sms', {
        headers: { 'x-correlation-id': correlationId },
        data: { to: '+5511999999999', message: 'SLA test message' },
      });

      const durationMs = Math.round(performance.now() - start);
      const SLA_MS = 2_000;

      expect(response.status()).toBe(200);
      expect(
        durationMs,
        `SLA BREACH: SMS notification took ${durationMs}ms, expected ≤ ${SLA_MS}ms`
      ).toBeLessThanOrEqual(SLA_MS);

      await db.deleteNotificationsByCorrelationId(correlationId);
    });

    test('disbursement should complete within SLA (3000ms — Pix BCB mandate)', async ({ request }) => {
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
      await pg.query(
        `UPDATE credit_requests SET status = 'APPROVED' WHERE id = $1`,
        [createdBody.id]
      );
      await pg.end();

      const start = performance.now();

      const response = await request.post(`/credit-requests/${createdBody.id}/disburse`, {
        data: { pixKey: 'company@business.com' },
      });

      const durationMs = Math.round(performance.now() - start);
      const SLA_MS = 3_000;

      expect(response.status()).toBe(201);
      expect(
        durationMs,
        `SLA BREACH: Pix disbursement took ${durationMs}ms, expected ≤ ${SLA_MS}ms (BCB mandate)`
      ).toBeLessThanOrEqual(SLA_MS);

      await db.deleteCreditRequest(createdBody.id);
    });

  });

  test.describe('Correlation ID propagation', () => {

    test('correlationId should propagate from request to response header and body', async ({ request }) => {
      const db = new DatabaseHelper();
      const testCorrelationId = `propagation-test-${Date.now()}`;

      const response = await request.post('/credit-requests', {
        headers: { 'x-correlation-id': testCorrelationId },
        data: {
          companyId:       '99.999.999/0001-99',
          companyName:     'Propagation Test LLC',
          requestedAmount: 50_000,
          email:           'test@propagation.com',
        },
      });

      expect(response.status()).toBe(201);

      // Layer 1: response header
      expect(
        response.headers()['x-correlation-id'],
        'correlationId must be echoed in response header'
      ).toBe(testCorrelationId);

      // Layer 2: response body
      const body = await response.json();
      expect(
        body.correlationId,
        'correlationId must be present in response body'
      ).toBe(testCorrelationId);

      // Layer 3: database
      const record = await db.getCreditRequestByCorrelationId(testCorrelationId);
      expect(
        record?.correlation_id,
        'correlationId must be persisted in credit_requests table'
      ).toBe(testCorrelationId);

      // Layer 4: audit trail
      const auditEvent = await db.getAuditEventByType(body.id, 'CREDIT_REQUEST_CREATED');
      expect(
        auditEvent?.correlation_id,
        'correlationId must be present in audit_events table'
      ).toBe(testCorrelationId);

      await db.deleteCreditRequest(body.id);
    });

    test('correlationId should propagate through notification layers', async ({ request }) => {
      const db = new DatabaseHelper();
      const journeyCorrelationId = `journey-propagation-${Date.now()}`;

      // Email notification with explicit journey correlationId
      const emailResponse = await request.post('/notifications/email', {
        data: {
          to:            'client@company.com',
          subject:       'Propagation test',
          correlationId: journeyCorrelationId,
        },
      });

      expect(emailResponse.status()).toBe(200);
      const emailBody = await emailResponse.json();
      expect(emailBody.correlationId).toBe(journeyCorrelationId);

      // SMS notification with same correlationId
      const smsResponse = await request.post('/notifications/sms', {
        data: {
          to:            '+5511999999999',
          message:       'Propagation test',
          correlationId: journeyCorrelationId,
        },
      });

      expect(smsResponse.status()).toBe(200);
      const smsBody = await smsResponse.json();
      expect(smsBody.correlationId).toBe(journeyCorrelationId);

      // Both notifications share the same correlationId in DB
      const emailRecord = await db.getNotification(journeyCorrelationId, 'email');
      const smsRecord   = await db.getNotification(journeyCorrelationId, 'sms');

      expect(emailRecord.correlation_id).toBe(journeyCorrelationId);
      expect(smsRecord.correlation_id).toBe(journeyCorrelationId);

      await db.deleteNotificationsByCorrelationId(journeyCorrelationId);
    });

  });

  test.describe('Audit trail integrity', () => {

    test('credit request creation should generate a complete audit event', async ({ request }) => {
      const db = new DatabaseHelper();
      const company = CompanyFactory.guaranteed();

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 50_000,
          email:           company.email,
        },
      });

      const body = await response.json();
      const events = await db.getAuditEvents(body.id);

      expect(events.length).toBeGreaterThanOrEqual(1);

      const createdEvent = events.find((e: any) => e.event_type === 'CREDIT_REQUEST_CREATED');
      expect(createdEvent, 'CREDIT_REQUEST_CREATED event must exist').toBeDefined();
      expect(createdEvent.correlation_id).toBe(body.correlationId);
      expect(createdEvent.actor).toBe('api/credit-requests');
      expect(createdEvent.new_state).toBe('PENDING_ANALYSIS');
      expect(createdEvent.created_at).toBeTruthy();

      await db.deleteCreditRequest(body.id);
    });

    test('disbursement should generate PIX_INITIATED audit event', async ({ request }) => {
      const db = new DatabaseHelper();
      const company = CompanyFactory.guaranteed();
      const { Client } = require('pg');

      const created = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 75_000,
          email:           company.email,
        },
      });
      const createdBody = await created.json();

      const pg = new Client((db as any).dbConfig);
      await pg.connect();
      await pg.query(
        `UPDATE credit_requests SET status = 'APPROVED' WHERE id = $1`,
        [createdBody.id]
      );
      await pg.end();

      const disbursement = await request.post(`/credit-requests/${createdBody.id}/disburse`, {
        data: { pixKey: 'audit@company.com' },
      });
      const disbursementBody = await disbursement.json();

      const pixEvent = await db.getAuditEventByType(createdBody.id, 'PIX_INITIATED');
      expect(pixEvent, 'PIX_INITIATED event must exist after disbursement').toBeDefined();
      expect(pixEvent.correlation_id).toBe(disbursementBody.correlationId);
      expect(pixEvent.actor).toBe('api/disburse');
      expect(pixEvent.previous_state).toBe('APPROVED');
      expect(pixEvent.new_state).toBe('DISBURSED');

      await db.deleteCreditRequest(createdBody.id);
    });

    test('audit events should be ordered chronologically', async ({ request }) => {
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
      await pg.query(
        `UPDATE credit_requests SET status = 'APPROVED' WHERE id = $1`,
        [createdBody.id]
      );
      await pg.end();

      await request.post(`/credit-requests/${createdBody.id}/disburse`, {
        data: { pixKey: 'order@company.com' },
      });

      const events = await db.getAuditEvents(createdBody.id);
      expect(events.length).toBeGreaterThanOrEqual(2);

      // Validate chronological order
      for (let i = 1; i < events.length; i++) {
        const prev = new Date(events[i - 1].created_at).getTime();
        const curr = new Date(events[i].created_at).getTime();
        expect(
          curr,
          `Event "${events[i].event_type}" must not precede "${events[i-1].event_type}"`
        ).toBeGreaterThanOrEqual(prev);
      }

      await db.deleteCreditRequest(createdBody.id);
    });

  });

});
