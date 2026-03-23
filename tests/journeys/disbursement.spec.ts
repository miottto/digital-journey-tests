import { test, expect } from '../../fixtures/index';
import { DatabaseHelper } from '../../utils/db-helper';
import { CompanyFactory } from '../../factories/CompanyFactory';

test.describe('Disbursement Journey', () => {

  async function createApprovedRequest(request: any, db: DatabaseHelper) {
    const company = CompanyFactory.guaranteed();

    const created = await request.post('/credit-requests', {
      data: {
        companyId:       company.companyId,
        companyName:     company.companyName,
        requestedAmount: 50_000,
        email:           company.email,
      },
    });
    const body = await created.json();

    // Manually approve in DB to simulate the approval flow
    const client = (db as any).dbConfig;
    const { Client } = require('pg');
    const pg = new Client(client);
    await pg.connect();
    await pg.query(
      `UPDATE credit_requests SET status = 'APPROVED' WHERE id = $1`,
      [body.id]
    );
    await pg.end();

    return body;
  }

  test('should disburse an approved credit request via Pix', async ({ request }) => {
    const db = new DatabaseHelper();
    const creditRequest = await createApprovedRequest(request, db);

    const response = await request.post(`/credit-requests/${creditRequest.id}/disburse`, {
      data: { pixKey: 'company@business.com' },
    });

    expect(response.status()).toBe(201);

    const body = await response.json();
    expect(body.disbursementId).toBeTruthy();
    expect(body.creditRequestId).toBe(creditRequest.id);
    expect(body.amount).toBe(50_000);
    expect(body.status).toBe('COMPLETED');
    expect(body.correlationId).toBeTruthy();
    expect(body.processedAt).toBeTruthy();

    // DB assertion — validates disbursement persisted
    const record = await db.getDisbursement(creditRequest.id);
    expect(record).toBeDefined();
    expect(record.amount).toBe(50_000);
    expect(record.pix_key).toBe('company@business.com');
    expect(record.status).toBe('COMPLETED');

    // Audit trail — PIX_INITIATED event recorded
    const auditEvent = await db.getAuditEventByType(creditRequest.id, 'PIX_INITIATED');
    expect(auditEvent).toBeDefined();
    expect(auditEvent.correlation_id).toBe(body.correlationId);

    // Cleanup
    await db.deleteCreditRequest(creditRequest.id);
  });

  test('should return 422 when pixKey is missing', async ({ request }) => {
    const db = new DatabaseHelper();
    const creditRequest = await createApprovedRequest(request, db);

    const response = await request.post(`/credit-requests/${creditRequest.id}/disburse`, {
      data: {},
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('pixKey is required.');

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

    // Try to disburse while still PENDING_ANALYSIS
    const response = await request.post(`/credit-requests/${createdBody.id}/disburse`, {
      data: { pixKey: 'company@business.com' },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('Only approved credit requests can be disbursed.');

    await db.deleteCreditRequest(createdBody.id);
  });

  test('should return 404 for non-existent credit request', async ({ request }) => {
    const response = await request.post('/credit-requests/non-existent-id/disburse', {
      data: { pixKey: 'company@business.com' },
    });

    expect(response.status()).toBe(404);
  });

  test('should carry correlationId through disbursement response', async ({ request }) => {
    const db = new DatabaseHelper();
    const creditRequest = await createApprovedRequest(request, db);
    const testCorrelationId = `disburse-test-${Date.now()}`;

    const response = await request.post(`/credit-requests/${creditRequest.id}/disburse`, {
      headers: { 'x-correlation-id': testCorrelationId },
      data: { pixKey: 'company@business.com' },
    });

    expect(response.status()).toBe(201);
    expect(response.headers()['x-correlation-id']).toBe(testCorrelationId);

    const body = await response.json();
    expect(body.correlationId).toBe(testCorrelationId);

    await db.deleteCreditRequest(creditRequest.id);
  });

});
