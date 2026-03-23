import { test, expect } from '../../fixtures/index';
import { DatabaseHelper } from '../../utils/db-helper';

test.describe('Notifications Journey', () => {

  test.describe('POST /notifications/email', () => {

    test('should deliver an email notification and persist it', async ({ request }) => {
      const db = new DatabaseHelper();
      const correlationId = `email-test-${Date.now()}`;

      const response = await request.post('/notifications/email', {
        headers: { 'x-correlation-id': correlationId },
        data: {
          to:      'client@company.com',
          subject: 'Your credit request has been approved',
          body:    'Congratulations! Your credit of R$50,000 has been approved.',
        },
      });

      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.id).toBeTruthy();
      expect(body.status).toBe('DELIVERED');
      expect(body.correlationId).toBe(correlationId);

      // DB assertion — validates real persistence
      const record = await db.getNotification(correlationId, 'email');
      expect(record).toBeDefined();
      expect(record.recipient).toBe('client@company.com');
      expect(record.subject).toBe('Your credit request has been approved');
      expect(record.status).toBe('DELIVERED');
      expect(record.correlation_id).toBe(correlationId);

      // Cleanup
      await db.deleteNotificationsByCorrelationId(correlationId);
    });

    test('should use correlationId from body when provided', async ({ request }) => {
      const db = new DatabaseHelper();
      const journeyCorrelationId = `journey-${Date.now()}`;

      const response = await request.post('/notifications/email', {
        data: {
          to:            'client@company.com',
          subject:       'Credit approved',
          correlationId: journeyCorrelationId,
        },
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.correlationId).toBe(journeyCorrelationId);

      const record = await db.getNotification(journeyCorrelationId, 'email');
      expect(record.correlation_id).toBe(journeyCorrelationId);

      await db.deleteNotificationsByCorrelationId(journeyCorrelationId);
    });

    test('should return 422 when required fields are missing', async ({ request }) => {
      const response = await request.post('/notifications/email', {
        data: { body: 'Missing to and subject' },
      });

      expect(response.status()).toBe(422);
      const body = await response.json();
      expect(body.error).toBe('to and subject are required.');
    });

    test('should echo correlationId in response header', async ({ request }) => {
      const db = new DatabaseHelper();
      const correlationId = `header-test-${Date.now()}`;

      const response = await request.post('/notifications/email', {
        headers: { 'x-correlation-id': correlationId },
        data: { to: 'test@test.com', subject: 'Test' },
      });

      expect(response.headers()['x-correlation-id']).toBe(correlationId);

      await db.deleteNotificationsByCorrelationId(correlationId);
    });

  });

  test.describe('POST /notifications/sms', () => {

    test('should deliver an SMS notification and persist it', async ({ request }) => {
      const db = new DatabaseHelper();
      const correlationId = `sms-test-${Date.now()}`;

      const response = await request.post('/notifications/sms', {
        headers: { 'x-correlation-id': correlationId },
        data: {
          to:      '+5511999999999',
          message: 'Your credit request #48291 has been approved. Amount: R$50,000.',
        },
      });

      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body.id).toBeTruthy();
      expect(body.status).toBe('DELIVERED');
      expect(body.correlationId).toBe(correlationId);

      // DB assertion
      const record = await db.getNotification(correlationId, 'sms');
      expect(record).toBeDefined();
      expect(record.recipient).toBe('+5511999999999');
      expect(record.content).toContain('#48291');
      expect(record.status).toBe('DELIVERED');
      expect(record.correlation_id).toBe(correlationId);

      await db.deleteNotificationsByCorrelationId(correlationId);
    });

    test('should return 422 when required fields are missing', async ({ request }) => {
      const response = await request.post('/notifications/sms', {
        data: { to: '+5511999999999' },
      });

      expect(response.status()).toBe(422);
      const body = await response.json();
      expect(body.error).toBe('to and message are required.');
    });

    test('should use correlationId from body when provided', async ({ request }) => {
      const db = new DatabaseHelper();
      const journeyCorrelationId = `sms-journey-${Date.now()}`;

      const response = await request.post('/notifications/sms', {
        data: {
          to:            '+5511999999999',
          message:       'Your request has been approved.',
          correlationId: journeyCorrelationId,
        },
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.correlationId).toBe(journeyCorrelationId);

      await db.deleteNotificationsByCorrelationId(journeyCorrelationId);
    });

  });

});
