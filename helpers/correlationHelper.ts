import { APIResponse, Page, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

export interface CorrelationTrace {
  correlationId: string;
  observations: CorrelationObservation[];
}

export interface CorrelationObservation {
  layer: string;
  foundAt: Date;
  source: 'response-header' | 'response-body' | 'email-header' | 'sms-body' | 'webhook-payload';
  value: string;
}

export class CorrelationHelper {
  private correlationId: string;
  private observations: CorrelationObservation[] = [];

  constructor(correlationId?: string) {
    this.correlationId = correlationId ?? `test-${randomUUID()}`;
  }

  get id(): string { return this.correlationId; }

  requestHeaders(): Record<string, string> {
    return { 'x-correlation-id': this.correlationId };
  }

  assertInApiResponse(response: APIResponse, layer: string): void {
    const headerValue = response.headers()['x-correlation-id'];
    expect(
      headerValue,
      `Correlation ID missing in response from "${layer}". Expected x-correlation-id: ${this.correlationId}`
    ).toBe(this.correlationId);
    this.observations.push({ layer, foundAt: new Date(), source: 'response-header', value: headerValue });
  }

  assertInWebhook(payload: Record<string, unknown>, layer = 'webhook'): void {
    const value = (payload['correlationId'] ?? payload['correlation_id']) as string;
    expect(value, `Correlation ID missing in webhook payload to "${layer}"`).toBe(this.correlationId);
    this.observations.push({ layer, foundAt: new Date(), source: 'webhook-payload', value });
  }

  async interceptPageRequests(page: Page, urlPattern: string | RegExp): Promise<void> {
    await page.route(urlPattern, async (route) => {
      const headers = { ...route.request().headers(), ...this.requestHeaders() };
      await route.continue({ headers });
    });
  }

  getTrace(): CorrelationTrace {
    return { correlationId: this.correlationId, observations: [...this.observations] };
  }

  assertFullPropagation(expectedLayers: string[]): void {
    const observedLayers = this.observations.map(o => o.layer);
    const missingLayers = expectedLayers.filter(l => !observedLayers.includes(l));
    expect(missingLayers, `Correlation ID not observed in layers: ${missingLayers.join(', ')}`).toHaveLength(0);
  }
}
