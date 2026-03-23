import { test, expect } from '../../fixtures/index';
import { DatabaseHelper } from '../../utils/db-helper';
import { CompanyFactory, CREDIT_RULES } from '../../factories/CompanyFactory';

/**
 * Boundary Rules Tests
 *
 * These tests validate the exact limits of the credit business rules.
 * They are the most valuable tests in the suite — they catch the bugs
 * that only appear at the edge of a condition:
 *   score=300 approves, score=299 rejects.
 *   90 days incorporated approves, 89 days rejects.
 *
 * Named personas from CompanyFactory communicate intent at the call site.
 * When a test fails, the message is immediately actionable.
 */

test.describe('Boundary Rules — Credit Request Validation', () => {

  test.describe('Amount boundaries', () => {

    test('should accept requestedAmount at minimum boundary (5000)', async ({ request }) => {
      const company = CompanyFactory.guaranteed();
      const db = new DatabaseHelper();

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: CREDIT_RULES.MIN_CREDIT_AMOUNT,
          email:           company.email,
        },
      });

      expect(response.status(), `Expected 201 at minimum amount ${CREDIT_RULES.MIN_CREDIT_AMOUNT}`).toBe(201);
      const body = await response.json();
      await db.deleteCreditRequest(body.id);
    });

    test('should reject requestedAmount one below minimum (4999)', async ({ request }) => {
      const company = CompanyFactory.guaranteed();

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: CREDIT_RULES.MIN_CREDIT_AMOUNT - 1,
          email:           company.email,
        },
      });

      expect(response.status(), `Expected 422 at one below minimum ${CREDIT_RULES.MIN_CREDIT_AMOUNT - 1}`).toBe(422);
    });

    test('should accept requestedAmount at maximum boundary (500000)', async ({ request }) => {
      const company = CompanyFactory.guaranteed();
      const db = new DatabaseHelper();

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: CREDIT_RULES.MAX_CREDIT_AMOUNT,
          email:           company.email,
        },
      });

      expect(response.status(), `Expected 201 at maximum amount ${CREDIT_RULES.MAX_CREDIT_AMOUNT}`).toBe(201);
      const body = await response.json();
      await db.deleteCreditRequest(body.id);
    });

    test('should reject requestedAmount one above maximum (500001)', async ({ request }) => {
      const company = CompanyFactory.guaranteed();

      const response = await request.post('/credit-requests', {
        data: {
          companyId:       company.companyId,
          companyName:     company.companyName,
          requestedAmount: CREDIT_RULES.MAX_CREDIT_AMOUNT + 1,
          email:           company.email,
        },
      });

      expect(response.status(), `Expected 422 at one above maximum ${CREDIT_RULES.MAX_CREDIT_AMOUNT + 1}`).toBe(422);
    });

  });

  test.describe('Idempotency — duplicate request protection', () => {

    test('should reject a second active request from the same company', async ({ request }) => {
      const company = CompanyFactory.guaranteed();
      const db = new DatabaseHelper();

      const payload = {
        companyId:       company.companyId,
        companyName:     company.companyName,
        requestedAmount: 50_000,
        email:           company.email,
      };

      const first = await request.post('/credit-requests', { data: payload });
      expect(first.status()).toBe(201);
      const firstBody = await first.json();

      // Simulate retry storm — 3 rapid duplicate submissions
      const [second, third, fourth] = await Promise.all([
        request.post('/credit-requests', { data: payload }),
        request.post('/credit-requests', { data: payload }),
        request.post('/credit-requests', { data: payload }),
      ]);

      expect(second.status()).toBe(409);
      expect(third.status()).toBe(409);
      expect(fourth.status()).toBe(409);

      // Only one record should exist in the database
      const record = await db.getCreditRequestByCompanyId(company.companyId);
      expect(record.id).toBe(firstBody.id);

      await db.deleteCreditRequest(firstBody.id);
    });

    test('should allow a new request after previous one is rejected', async ({ request }) => {
      const company = CompanyFactory.guaranteed();
      const db = new DatabaseHelper();
      const { Client } = require('pg');

      const payload = {
        companyId:       company.companyId,
        companyName:     company.companyName,
        requestedAmount: 50_000,
        email:           company.email,
      };

      // First request
      const first = await request.post('/credit-requests', { data: payload });
      const firstBody = await first.json();

      // Manually reject it
      const pg = new Client((db as any).dbConfig);
      await pg.connect();
      await pg.query(
        `UPDATE credit_requests SET status = 'REJECTED' WHERE id = $1`,
        [firstBody.id]
      );
      await pg.end();

      // Second request — should now be allowed
      const second = await request.post('/credit-requests', { data: payload });
      expect(second.status()).toBe(201);
      const secondBody = await second.json();

      expect(secondBody.id).not.toBe(firstBody.id);

      await db.deleteCreditRequest(firstBody.id);
      await db.deleteCreditRequest(secondBody.id);
    });

  });

  test.describe('Correlation ID integrity', () => {

    test('each request should receive a unique correlationId', async ({ request }) => {
      const companies = CompanyFactory.multiple(3);
      const db = new DatabaseHelper();
      const ids: string[] = [];

      const responses = await Promise.all(
        companies.map(company =>
          request.post('/credit-requests', {
            data: {
              companyId:       company.companyId,
              companyName:     company.companyName,
              requestedAmount: 50_000,
              email:           company.email,
            },
          })
        )
      );

      const correlationIds = await Promise.all(
        responses.map(async r => {
          const body = await r.json();
          ids.push(body.id);
          return body.correlationId;
        })
      );

      // All correlationIds must be unique
      const unique = new Set(correlationIds);
      expect(unique.size).toBe(3);

      // Cleanup
      for (const id of ids) {
        await db.deleteCreditRequest(id);
      }
    });

    test('correlationId should be stored in audit event matching the response', async ({ request }) => {
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

      const body = await response.json();
      const auditEvent = await db.getAuditEventByType(body.id, 'CREDIT_REQUEST_CREATED');

      expect(auditEvent.correlation_id).toBe(body.correlationId);

      await db.deleteCreditRequest(body.id);
    });

  });

});
