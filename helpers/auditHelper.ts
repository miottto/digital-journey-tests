import { APIRequestContext, expect } from '@playwright/test';

export type CreditEventType =
  | 'CREDIT_REQUEST_CREATED'
  | 'AI_ANALYSIS_STARTED'
  | 'AI_ANALYSIS_COMPLETED'
  | 'AI_ANALYSIS_FALLBACK'
  | 'RULES_ENGINE_EVALUATED'
  | 'CREDIT_APPROVED'
  | 'CREDIT_REJECTED'
  | 'WEBHOOK_DISPATCHED'
  | 'WEBHOOK_FAILED'
  | 'WEBHOOK_RETRIED'
  | 'EMAIL_QUEUED'
  | 'EMAIL_DELIVERED'
  | 'SMS_QUEUED'
  | 'SMS_DELIVERED'
  | 'CONTRACT_GENERATED'
  | 'PIX_INITIATED'
  | 'PIX_COMPLETED';

export const APPROVED_JOURNEY_SEQUENCE: CreditEventType[] = [
  'CREDIT_REQUEST_CREATED',
  'AI_ANALYSIS_STARTED',
  'AI_ANALYSIS_COMPLETED',
  'RULES_ENGINE_EVALUATED',
  'CREDIT_APPROVED',
  'EMAIL_QUEUED',
  'EMAIL_DELIVERED',
  'SMS_QUEUED',
  'SMS_DELIVERED',
  'PIX_INITIATED',
];

export const REJECTED_JOURNEY_SEQUENCE: CreditEventType[] = [
  'CREDIT_REQUEST_CREATED',
  'AI_ANALYSIS_STARTED',
  'AI_ANALYSIS_COMPLETED',
  'RULES_ENGINE_EVALUATED',
  'CREDIT_REJECTED',
  'EMAIL_QUEUED',
  'EMAIL_DELIVERED',
];

export class AuditHelper {
  constructor(private request: APIRequestContext) {}

  async getEvents(creditRequestId: string) {
    const response = await this.request.get(`/audit/credit-requests/${creditRequestId}/events`);
    expect(response.status(), 'Audit log endpoint must be accessible').toBe(200);
    const body = await response.json();
    return body.events;
  }

  async assertEventRecorded(creditRequestId: string, eventType: CreditEventType) {
    const events = await this.getEvents(creditRequestId);
    const event = events.find((e: any) => e.event_type === eventType);
    expect(event, `Audit event "${eventType}" was not recorded for request "${creditRequestId}".`).toBeDefined();
    return event;
  }

  async assertSequence(creditRequestId: string, expectedSequence: CreditEventType[]) {
    const events = await this.getEvents(creditRequestId);
    const eventTypes = events.map((e: any) => e.event_type);
    const missingEvents = expectedSequence.filter(e => !eventTypes.includes(e));
    expect(
      missingEvents,
      `Missing audit events: ${missingEvents.join(', ')}`
    ).toHaveLength(0);
  }

  async assertCorrelationIdPropagated(creditRequestId: string, expectedCorrelationId: string) {
    const events = await this.getEvents(creditRequestId);
    const mismatched = events.filter((e: any) => e.correlation_id !== expectedCorrelationId);
    expect(
      mismatched.map((e: any) => e.event_type),
      `These audit events are missing correlationId "${expectedCorrelationId}"`
    ).toHaveLength(0);
  }
}
