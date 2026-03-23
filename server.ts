import 'dotenv/config';
import express from 'express';
import { Client } from 'pg';
import cors from 'cors';
import bodyParser from 'body-parser';
import { randomUUID } from 'crypto';
import { ChatbotAdapter } from './chatbot/ChatbotAdapter';

console.log('⚡ Starting Digital Journey API...');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Invalid JSON.',
      message: 'Request body must be valid JSON.',
    });
  }
  next(err);
});

app.use((req, res, next) => {
  const id = (req.headers['x-correlation-id'] as string) ?? randomUUID();
  res.setHeader('x-correlation-id', id);
  (req as any).correlationId = id;
  next();
});

const dbConfig = {
  user:     process.env.DB_USER     || 'admin',
  host:     process.env.DB_HOST     || 'localhost',
  database: process.env.DB_NAME     || 'journey_db',
  password: process.env.DB_PASS     || 'password123',
  port:     parseInt(process.env.DB_PORT || '5432'),
};

const initDB = async () => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_requests (
        id               VARCHAR(100) PRIMARY KEY,
        correlation_id   VARCHAR(100) UNIQUE NOT NULL,
        company_id       VARCHAR(20)  NOT NULL,
        company_name     VARCHAR(200) NOT NULL,
        requested_amount DECIMAL(12, 2) NOT NULL,
        email            VARCHAR(200) NOT NULL,
        status           VARCHAR(30)  NOT NULL DEFAULT 'PENDING_ANALYSIS',
        score            INTEGER,
        rejection_reason TEXT,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id                VARCHAR(100) PRIMARY KEY,
        event_type        VARCHAR(60)  NOT NULL,
        credit_request_id VARCHAR(100),
        correlation_id    VARCHAR(100) NOT NULL,
        actor             VARCHAR(100) NOT NULL,
        payload           JSONB,
        previous_state    VARCHAR(30),
        new_state         VARCHAR(30),
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id             VARCHAR(100) PRIMARY KEY,
        correlation_id VARCHAR(100) NOT NULL,
        type           VARCHAR(10)  NOT NULL,
        recipient      VARCHAR(200) NOT NULL,
        subject        VARCHAR(300),
        content        TEXT,
        status         VARCHAR(20)  NOT NULL DEFAULT 'QUEUED',
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS disbursements (
        id                VARCHAR(100) PRIMARY KEY,
        credit_request_id VARCHAR(100) NOT NULL,
        correlation_id    VARCHAR(100) NOT NULL,
        amount            DECIMAL(12, 2) NOT NULL,
        pix_key           VARCHAR(200) NOT NULL,
        status            VARCHAR(20)  NOT NULL DEFAULT 'INITIATED',
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ All tables are ready.');
  } catch (err) {
    console.error('❌ Database init error:', err);
  } finally {
    await client.end();
  }
};

async function auditEvent(params: {
  eventType: string;
  creditRequestId?: string;
  correlationId: string;
  actor: string;
  payload?: object;
  previousState?: string;
  newState?: string;
}) {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    await client.query(
      `INSERT INTO audit_events
        (id, event_type, credit_request_id, correlation_id, actor, payload, previous_state, new_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        params.eventType,
        params.creditRequestId ?? null,
        params.correlationId,
        params.actor,
        params.payload ? JSON.stringify(params.payload) : null,
        params.previousState ?? null,
        params.newState ?? null,
      ]
    );
  } finally {
    await client.end();
  }
}

app.get('/', (_req, res) => res.status(200).json({ status: 'ok', service: 'Digital Journey API' }));

app.get('/portfolio/summary', async (_req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const result = await client.query(`
      SELECT
        COUNT(*)                                         AS total_requests,
        COUNT(*) FILTER (WHERE status = 'APPROVED')      AS approved,
        COUNT(*) FILTER (WHERE status = 'REJECTED')      AS rejected,
        COUNT(*) FILTER (WHERE status = 'PENDING_ANALYSIS') AS pending,
        COALESCE(SUM(requested_amount) FILTER (WHERE status = 'APPROVED'), 0) AS total_credit_deployed
      FROM credit_requests
    `);
    const row = result.rows[0];
    res.status(200).json({
      totalRequests:       parseInt(row.total_requests),
      approved:            parseInt(row.approved),
      rejected:            parseInt(row.rejected),
      pending:             parseInt(row.pending),
      totalCreditDeployed: parseFloat(row.total_credit_deployed),
      currency:            'BRL',
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await client.end();
  }
});

app.post('/credit-requests', async (req, res) => {
  const { companyId, companyName, requestedAmount, email } = req.body;
  const correlationId = (req as any).correlationId;

  if (!companyId || !companyName || !requestedAmount || !email) {
    return res.status(422).json({
      error: 'Validation failed.',
      details: [
        !companyId        && 'companyId is required',
        !companyName      && 'companyName is required',
        !requestedAmount  && 'requestedAmount is required',
        !email            && 'email is required',
      ].filter(Boolean),
    });
  }

  if (typeof requestedAmount !== 'number' || isNaN(requestedAmount)) {
    return res.status(422).json({
      error: 'Validation failed.',
      details: ['requestedAmount must be a valid number.'],
    });
  }

  const AMOUNT_MIN = 5_000;
  const AMOUNT_MAX = 500_000;
  if (requestedAmount < AMOUNT_MIN || requestedAmount > AMOUNT_MAX) {
    return res.status(422).json({
      error: 'Validation failed.',
      details: [`requestedAmount must be between ${AMOUNT_MIN} and ${AMOUNT_MAX}.`],
    });
  }

  const id = randomUUID();
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const existing = await client.query(
      `SELECT id FROM credit_requests
       WHERE company_id = $1 AND status NOT IN ('APPROVED','REJECTED') LIMIT 1`,
      [companyId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict.',
        message: 'An active credit request already exists for this company.',
        existingRequestId: existing.rows[0].id,
      });
    }
    await client.query(
      `INSERT INTO credit_requests
        (id, correlation_id, company_id, company_name, requested_amount, email, status)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING_ANALYSIS')`,
      [id, correlationId, companyId, companyName, requestedAmount, email]
    );
    await auditEvent({
      eventType: 'CREDIT_REQUEST_CREATED',
      creditRequestId: id,
      correlationId,
      actor: 'api/credit-requests',
      payload: { companyId, requestedAmount },
      newState: 'PENDING_ANALYSIS',
    });
    res.status(201).json({
      id,
      correlationId,
      status: 'PENDING_ANALYSIS',
      createdAt: new Date().toISOString(),
      message: 'Credit request received. Analysis in progress.',
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await client.end();
  }
});

app.get('/credit-requests/:id', async (req, res) => {
  const { id } = req.params;
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM credit_requests WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Credit request not found.' });
    res.status(200).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await client.end();
  }
});

app.get('/audit/credit-requests/:id/events', async (req, res) => {
  const { id } = req.params;
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const result = await client.query(
      `SELECT * FROM audit_events WHERE credit_request_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    res.status(200).json({ events: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await client.end();
  }
});

const chatbot = new ChatbotAdapter();

app.post('/chatbot/message', async (req, res) => {
  const { message, sessionId } = req.body;
  const correlationId = (req as any).correlationId;
  if (!message) return res.status(422).json({ error: 'message is required.' });
  try {
    const response = await chatbot.send(message, sessionId ?? randomUUID());
    res.status(200).json({ ...response, correlationId });
  } catch (error) {
    console.error('[Chatbot]', error);
    res.status(500).json({ error: 'Chatbot service unavailable.' });
  }
});

app.post('/notifications/email', async (req, res) => {
  const { to, subject, body, correlationId: reqCorrelationId } = req.body;
  const correlationId = reqCorrelationId ?? (req as any).correlationId;
  if (!to || !subject) return res.status(422).json({ error: 'to and subject are required.' });
  const id = randomUUID();
  const client = new Client(dbConfig);
  try {
    await client.connect();
    await client.query(
      `INSERT INTO notifications (id, correlation_id, type, recipient, subject, content, status)
       VALUES ($1,$2,'email',$3,$4,$5,'DELIVERED')`,
      [id, correlationId, to, subject, body ?? '']
    );
    res.status(200).json({ id, status: 'DELIVERED', correlationId });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await client.end();
  }
});

app.post('/notifications/sms', async (req, res) => {
  const { to, message, correlationId: reqCorrelationId } = req.body;
  const correlationId = reqCorrelationId ?? (req as any).correlationId;
  if (!to || !message) return res.status(422).json({ error: 'to and message are required.' });
  const id = randomUUID();
  const client = new Client(dbConfig);
  try {
    await client.connect();
    await client.query(
      `INSERT INTO notifications (id, correlation_id, type, recipient, content, status)
       VALUES ($1,$2,'sms',$3,$4,'DELIVERED')`,
      [id, correlationId, to, message]
    );
    res.status(200).json({ id, status: 'DELIVERED', correlationId });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await client.end();
  }
});

app.post('/credit-requests/:id/webhook', async (req, res) => {
  const { id } = req.params;
  const correlationId = (req as any).correlationId;
  const erpUrl = process.env.ERP_WEBHOOK_URL;

  const client = new Client(dbConfig);
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM credit_requests WHERE id = $1', [id]);
    if (!result.rows.length) 
      return res.status(404).json({ error: 'Credit request not found.' });

    const request = result.rows[0];
    if (request.status !== 'APPROVED') {
      return res.status(422).json({ error: 'Webhook can only be dispatched for approved credit requests.' });
    }

    if (!erpUrl) {
      await auditEvent({
        eventType: 'WEBHOOK_FAILED',
        creditRequestId: id,
        correlationId,
        actor: 'api/webhook',
        payload: { reason: 'ERP_WEBHOOK_URL not configured' },
      });
      return res.status(200).json({ status: 'FAILED', reason: 'ERP_WEBHOOK_URL not configured', correlationId });
    }

    try {
      const erpResponse = await fetch(erpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify({
          event: 'CREDIT_APPROVED',
          creditRequestId: id,
          companyId: request.company_id,
          companyName: request.company_name,
          requestedAmount: parseFloat(request.requested_amount),
          correlationId,
          approvedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!erpResponse.ok) {
        await auditEvent({
          eventType: 'WEBHOOK_FAILED',
          creditRequestId: id,
          correlationId,
          actor: 'api/webhook',
          payload: { erpStatus: erpResponse.status, erpUrl },
        });
        return res.status(200).json({ status: 'FAILED', erpStatus: erpResponse.status, correlationId });
      }

      await auditEvent({
        eventType: 'WEBHOOK_DISPATCHED',
        creditRequestId: id,
        correlationId,
        actor: 'api/webhook',
        payload: { erpUrl, erpStatus: erpResponse.status },
      });
      return res.status(200).json({ status: 'DISPATCHED', correlationId });
    } catch (webhookError) {
      await auditEvent({
        eventType: 'WEBHOOK_FAILED',
        creditRequestId: id,
        correlationId,
        actor: 'api/webhook',
        payload: { reason: (webhookError as Error).message },
      });
      return res.status(200).json({ status: 'FAILED', reason: 'ERP unreachable', correlationId });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await client.end();
  }
});

app.post('/credit-requests/:id/disburse', async (req, res) => {
  const { id } = req.params;
  const { pixKey } = req.body;
  const correlationId = (req as any).correlationId;
  if (!pixKey) return res.status(422).json({ error: 'pixKey is required.' });
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM credit_requests WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Credit request not found.' });
    const request = result.rows[0];
    if (request.status !== 'APPROVED') {
      return res.status(422).json({ error: 'Only approved credit requests can be disbursed.' });
    }
    const disbursementId = randomUUID();
    await client.query(
      `INSERT INTO disbursements (id, credit_request_id, correlation_id, amount, pix_key, status)
       VALUES ($1,$2,$3,$4,$5,'COMPLETED')`,
      [disbursementId, id, correlationId, request.requested_amount, pixKey]
    );
    await auditEvent({
      eventType: 'PIX_INITIATED',
      creditRequestId: id,
      correlationId,
      actor: 'api/disburse',
      payload: { disbursementId, amount: request.requested_amount, pixKey },
      previousState: 'APPROVED',
      newState: 'DISBURSED',
    });
    res.status(201).json({
      disbursementId,
      creditRequestId: id,
      amount: parseFloat(request.requested_amount),
      status: 'COMPLETED',
      correlationId,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await client.end();
  }
});

app.listen(Number(PORT), '0.0.0.0', async () => {
  await initDB();
  console.log(`✅ Digital Journey API running at http://0.0.0.0:${PORT}`);
  console.log(`   AI Agent: ${process.env.USE_REAL_AI === 'true' ? 'Gemini ADK (real)' : 'Mock (deterministic)'}`);
});
