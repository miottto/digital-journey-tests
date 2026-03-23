import { test, expect } from '../../fixtures/index';
import { DatabaseHelper } from '../../utils/db-helper';
import { CompanyFactory } from '../../factories/CompanyFactory';

test.describe('Credit Request Journey', () => {

  test.describe('POST /credit-requests', () => {

    test('should create a credit request and persist it to the database', async ({ request }) => {
      const company = CompanyFactory.guaranteed();
      const db = new DatabaseHelper();

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 50_000,
          email:           company.email,
        },
      });

      expect(response.status()).toBe(201);

      const body = await response.json();
      expect(body.id).toBeTruthy();
      expect(body.correlationId).toBeTruthy();
      expect(body.status).toBe('PENDING_ANALYSIS');

      // DB assertion — validates real persistence, not just HTTP response
      const record = await db.getCreditRequestById(body.id);
      expect(record).toBeDefined();
      expect(record.status).toBe('PENDING_ANALYSIS');
      expect(record.company_id).toBe(company.companyId);
      expect(record.requested_amount).toBe(50_000);

      // Audit trail — validates first event was recorded
      const auditEvent = await db.getAuditEventByType(body.id, 'CREDIT_REQUEST_CREATED');
      expect(auditEvent).toBeDefined();
      expect(auditEvent.correlation_id).toBe(body.correlationId);

      // Cleanup
      await db.deleteCreditRequest(body.id);
    });

    test('should return 422 when required fields are missing', async ({ request }) => {
      const response = await request.post('/credit-requests', {
        data: { companyId: 'MISSING_OTHER_FIELDS' },
      });

      expect(response.status()).toBe(422);

      const body = await response.json();
      expect(body.error).toBe('Validation failed.');
      expect(body.details).toContain('companyName is required');
      expect(body.details).toContain('requestedAmount is required');
      expect(body.details).toContain('email is required');
    });

    test('should return 422 when requestedAmount is below minimum', async ({ request }) => {
      const company = CompanyFactory.guaranteed();

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 1_000,
          email:           company.email,
        },
      });

      expect(response.status()).toBe(422);
      const body = await response.json();
      expect(body.details[0]).toContain('requestedAmount must be between');
    });

    test('should return 422 when requestedAmount is above maximum', async ({ request }) => {
      const company = CompanyFactory.guaranteed();

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 999_999,
          email:           company.email,
        },
      });

      expect(response.status()).toBe(422);
      const body = await response.json();
      expect(body.details[0]).toContain('requestedAmount must be between');
    });

    test('should return 409 when company already has an active request', async ({ request }) => {
      const company = CompanyFactory.guaranteed();
      const db = new DatabaseHelper();

      const payload = {
        companyId:       company.companyId,
        companyName:     company.companyName,
        requestedAmount: 50_000,
        email:           company.email,
      };

      // First request — should succeed
      const first = await request.post('/credit-requests', { data: payload });
      expect(first.status()).toBe(201);
      const firstBody = await first.json();

      // Second request — same company, should conflict
      const second = await request.post('/credit-requests', { data: payload });
      expect(second.status()).toBe(409);

      const secondBody = await second.json();
      expect(secondBody.error).toBe('Conflict.');
      expect(secondBody.existingRequestId).toBe(firstBody.id);

      // Cleanup
      await db.deleteCreditRequest(firstBody.id);
    });

    test('correlation ID from request header should be echoed in response header', async ({ request }) => {
      const company = CompanyFactory.guaranteed();
      const db = new DatabaseHelper();
      const testCorrelationId = `test-${Date.now()}`;

      const response = await request.post('/credit-requests', {
        headers: { 'x-correlation-id': testCorrelationId },
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 50_000,
          email:           company.email,
        },
      });

      expect(response.status()).toBe(201);
      expect(response.headers()['x-correlation-id']).toBe(testCorrelationId);

      const body = await response.json();
      expect(body.correlationId).toBe(testCorrelationId);

      // Cleanup
      await db.deleteCreditRequest(body.id);
    });

  });

  test.describe('GET /credit-requests/:id', () => {

    test('should retrieve an existing credit request by ID', async ({ request }) => {
      const company = CompanyFactory.guaranteed();
      const db = new DatabaseHelper();

      const created = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: 75_000,
          email:           company.email,
        },
      });
      const createdBody = await created.json();

      const response = await request.get(`/credit-requests/${createdBody.id}`);
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.id).toBe(createdBody.id);
      expect(body.status).toBe('PENDING_ANALYSIS');
      expect(body.correlation_id).toBe(createdBody.correlationId);

      // Cleanup
      await db.deleteCreditRequest(createdBody.id);
    });

    test('should return 404 for a non-existent credit request', async ({ request }) => {
      const response = await request.get('/credit-requests/non-existent-id-00000');
      expect(response.status()).toBe(404);
    });

  });

  test.describe('GET /portfolio/summary', () => {

    test('should return portfolio metrics with correct shape', async ({ request }) => {
      const response = await request.get('/portfolio/summary');
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(typeof body.totalRequests).toBe('number');
      expect(typeof body.approved).toBe('number');
      expect(typeof body.rejected).toBe('number');
      expect(typeof body.pending).toBe('number');
      expect(typeof body.totalCreditDeployed).toBe('number');
      expect(body.currency).toBe('BRL');
    });

  });

});
