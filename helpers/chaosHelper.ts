import { Page, Route } from '@playwright/test';

export type FailureMode =
  | 'network-error'
  | 'timeout'
  | 'http-500'
  | 'http-503'
  | 'http-429'
  | 'partial-response'
  | 'slow-response';

export class ChaosHelper {
  private page: Page;
  private activeInterceptions: (() => Promise<void>)[] = [];

  constructor(page: Page) { this.page = page; }

  async failEmailService(mode: FailureMode = 'http-503'): Promise<void> {
    await this.intercept(/\/notifications\/email/, mode);
  }

  async failSmsGateway(mode: FailureMode = 'http-503'): Promise<void> {
    await this.intercept(/\/notifications\/sms/, mode);
  }

  async failAiAgent(mode: FailureMode = 'timeout', delayMs = 11_000): Promise<void> {
    await this.intercept(/\/chatbot\/message/, mode, { delayMs });
  }

  async rateLimitSmsGateway(): Promise<void> {
    await this.intercept(/\/notifications\/sms/, 'http-429');
  }

  async slowPixApi(delayMs = 4_000): Promise<void> {
    await this.intercept(/\/credit-requests\/.*\/disburse/, 'slow-response', { delayMs });
  }

  private async intercept(
    urlPattern: RegExp,
    mode: FailureMode,
    config: { delayMs?: number; affectPercentage?: number } = {}
  ): Promise<void> {
    const { delayMs = 0, affectPercentage = 100 } = config;

    await this.page.route(urlPattern, async (route: Route) => {
      const shouldFail = Math.random() * 100 < affectPercentage;
      if (!shouldFail) { await route.continue(); return; }

      switch (mode) {
        case 'network-error':
          await route.abort('connectionrefused');
          break;
        case 'timeout':
          await new Promise(resolve => setTimeout(resolve, delayMs || 30_000));
          await route.abort('timedout');
          break;
        case 'http-500':
          await route.fulfill({ status: 500, contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal Server Error', message: 'chaos-injected failure' }) });
          break;
        case 'http-503':
          await route.fulfill({ status: 503, contentType: 'application/json',
            headers: { 'Retry-After': '30' },
            body: JSON.stringify({ error: 'Service Unavailable' }) });
          break;
        case 'http-429':
          await route.fulfill({ status: 429, contentType: 'application/json',
            headers: { 'Retry-After': '60', 'X-RateLimit-Reset': String(Date.now() + 60_000) },
            body: JSON.stringify({ error: 'Too Many Requests' }) });
          break;
        case 'partial-response':
          await route.fulfill({ status: 200, contentType: 'application/json',
            body: '{"status":"delivered","correlationId":"abc123"' });
          break;
        case 'slow-response':
          await new Promise(resolve => setTimeout(resolve, delayMs));
          await route.continue();
          break;
      }
    });

    this.activeInterceptions.push(async () => { await this.page.unroute(urlPattern); });
  }

  async restore(): Promise<void> {
    for (const cleanup of this.activeInterceptions) await cleanup();
    this.activeInterceptions = [];
  }
}
