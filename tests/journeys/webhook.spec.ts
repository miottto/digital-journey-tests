import { test, expect } from '../../fixtures/index';
import { DatabaseHelper } from '../../utils/db-helper';
import { CompanyFactory } from '../../factories/CompanyFactory';

test.describe('Webhook to ERP Journey', () => {

  async function createApprovedRequest(request: any, db: DatabaseHelper) {
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
    const body = await created.json();

    const pg = new Client((db as any).dbConfig);
    await pg.connect();
    await pg.query(`UPDATE credit_requests SET status = 'APPROVED' WHERE id = $1`, [body.id]);
    await pg.end();

    return body;
  }

  test('should record a webhook audit event for an approved credit request', async ({ request }) => {
    const db = new DatabaseHelper();
    const creditRequest = await createApprovedRequest(request, db);

    const response = await request.post(`/credit-requests/${creditRequest.id}/webhook`);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.correlationId).toBeTruthy();
    expect(['DISPATCHED', 'FAILED']).toContain(body.status);

    // A webhook audit event must always be recorded — dispatched or failed
    const events = await db.getAuditEvents(creditRequest.id);
    const webhookEvent = events.find((e: any) =>
      e.event_type === 'WEBHOOK_DISPATCHED' || e.event_type === 'WEBHOOK_FAILED'
    );
    expect(webhookEvent, 'A webhook audit event must be recorded').toBeDefined();
    expect(webhookEvent.actor).toBe('api/webhook');
    expect(webhookEvent.correlation_id).toBe(body.correlationId);

    await db.deleteCreditRequest(creditRequest.id);
  });

  test('should carry correlationId through webhook response and audit event', async ({ request }) => {
    const db = new DatabaseHelper();
    const creditRequest = await createApprovedRequest(request, db);
    const testCorrelationId = `webhook-test-${Date.now()}`;

    const response = await request.post(`/credit-requests/${creditRequest.id}/webhook`, {
      headers: { 'x-correlation-id': testCorrelationId },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['x-correlation-id']).toBe(testCorrelationId);

    const body = await response.json();
    expect(body.correlationId).toBe(testCorrelationId);

    const events = await db.getAuditEvents(creditRequest.id);
    const webhookEvent = events.find((e: any) =>
      e.event_type === 'WEBHOOK_DISPATCHED' || e.event_type === 'WEBHOOK_FAILED'
    );
    expect(webhookEvent.correlation_id).toBe(testCorrelationId);

    await db.deleteCreditRequest(creditRequest.id);
  });

  test('webhook dispatch should complete within SLA (5000ms)', async ({ request, sla }) => {
    const db = new DatabaseHelper();
    const creditRequest = await createApprovedRequest(request, db);

    const response = await sla.measure('WEBHOOK_DISPATCH', async () =>
      request.post(`/credit-requests/${creditRequest.id}/webhook`)
    );

    expect(response.status()).toBe(200);
    sla.assertWithinSla('WEBHOOK_DISPATCH');

    await db.deleteCreditRequest(creditRequest.id);
  });

  test('should return 422 when credit request is not approved', async ({ request }) => {
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

    const response = await request.post(`/credit-requests/${createdBody.id}/webhook`);

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('Webhook can only be dispatched for approved credit requests.');

    await db.deleteCreditRequest(createdBody.id);
  });

  test('should return 404 for non-existent credit request', async ({ request }) => {
    const response = await request.post('/credit-requests/non-existent-id/webhook');
    expect(response.status()).toBe(404);
  });

});
