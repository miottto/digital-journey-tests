import { Client } from 'pg';

export class DatabaseHelper {
  private dbConfig: any;

  constructor() {
    this.dbConfig = {
      user:     process.env.DB_USER     || 'admin',
      host:     process.env.DB_HOST     || 'localhost',
      database: process.env.DB_NAME     || 'journey_db',
      password: process.env.DB_PASS     || 'password123',
      port:     parseInt(process.env.DB_PORT || '5432'),
    };
  }

  async getCreditRequestById(id: string) {
    const client = new Client(this.dbConfig);
    try {
      await client.connect();
      const result = await client.query('SELECT * FROM credit_requests WHERE id = $1', [id]);
      const row = result.rows[0];
      if (!row) return null;
      return { ...row, requested_amount: parseFloat(row.requested_amount) };
    } finally {
      await client.end();
    }
  }

  async getCreditRequestByCorrelationId(correlationId: string) {
    const client = new Client(this.dbConfig);
    try {
      await client.connect();
      const result = await client.query('SELECT * FROM credit_requests WHERE correlation_id = $1', [correlationId]);
      return result.rows[0] ?? null;
    } finally {
      await client.end();
    }
  }

  async getCreditRequestByCompanyId(companyId: string) {
    const client = new Client(this.dbConfig);
    try {
      await client.connect();
      const result = await client.query(
        `SELECT * FROM credit_requests WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [companyId]
      );
      return result.rows[0] ?? null;
    } finally {
      await client.end();
    }
  }

  async getAuditEvents(creditRequestId: string) {
    const client = new Client(this.dbConfig);
    try {
      await client.connect();
      const result = await client.query(
        `SELECT * FROM audit_events WHERE credit_request_id = $1 ORDER BY created_at ASC`,
        [creditRequestId]
      );
      return result.rows;
    } finally {
      await client.end();
    }
  }

  async getAuditEventByType(creditRequestId: string, eventType: string) {
    const client = new Client(this.dbConfig);
    try {
      await client.connect();
      const result = await client.query(
        `SELECT * FROM audit_events WHERE credit_request_id = $1 AND event_type = $2 ORDER BY created_at ASC LIMIT 1`,
        [creditRequestId, eventType]
      );
      return result.rows[0] ?? null;
    } finally {
      await client.end();
    }
  }

  async getNotification(correlationId: string, type: 'email' | 'sms') {
    const client = new Client(this.dbConfig);
    try {
      await client.connect();
      const result = await client.query(
        `SELECT * FROM notifications WHERE correlation_id = $1 AND type = $2 ORDER BY created_at DESC LIMIT 1`,
        [correlationId, type]
      );
      return result.rows[0] ?? null;
    } finally {
      await client.end();
    }
  }

  async getDisbursement(creditRequestId: string) {
    const client = new Client(this.dbConfig);
    try {
      await client.connect();
      const result = await client.query(
        `SELECT * FROM disbursements WHERE credit_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [creditRequestId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return { ...row, amount: parseFloat(row.amount) };
    } finally {
      await client.end();
    }
  }

  async deleteCreditRequest(id: string) {
    const client = new Client(this.dbConfig);
    try {
      await client.connect();
      await client.query('DELETE FROM disbursements WHERE credit_request_id = $1', [id]);
      await client.query('DELETE FROM audit_events WHERE credit_request_id = $1', [id]);
      await client.query('DELETE FROM credit_requests WHERE id = $1', [id]);
    } finally {
      await client.end();
    }
  }

  async deleteNotificationsByCorrelationId(correlationId: string) {
    const client = new Client(this.dbConfig);
    try {
      await client.connect();
      await client.query('DELETE FROM notifications WHERE correlation_id = $1', [correlationId]);
    } finally {
      await client.end();
    }
  }
}
