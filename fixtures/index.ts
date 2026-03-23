import { test as base, APIRequestContext } from '@playwright/test';
import { SlaHelper } from '../helpers/slaHelper';
import { CorrelationHelper } from '../helpers/correlationHelper';
import { ChaosHelper } from '../helpers/chaosHelper';
import { AuditHelper } from '../helpers/auditHelper';
import { DatabaseHelper } from '../utils/db-helper';
import { CompanyFactory, type Company } from '../factories/CompanyFactory';

type JourneyFixtures = {
  sla:         SlaHelper;
  correlation: CorrelationHelper;
  chaos:       ChaosHelper;
  audit:       AuditHelper;
  db:          DatabaseHelper;
  creditApi:   APIRequestContext;
  guaranteed:  Company;
  defaulted:   Company;
  ambiguous:   Company;
  atScoreLimit: Company;
};

export const test = base.extend<JourneyFixtures>({
  sla: async ({}, use) => {
    const helper = new SlaHelper();
    await use(helper);
    const summary = helper.getSummary();
    if (summary.length > 0) {
      console.log('\nSLA Report:\n' + summary.map(m =>
        `  ${m.withinSla ? '✓' : '✗'} ${m.stepName}: ${m.durationMs}ms`
      ).join('\n'));
    }
  },

  correlation: async ({}, use) => {
    const helper = new CorrelationHelper();
    await use(helper);
    const trace = helper.getTrace();
    if (trace.observations.length > 0) {
      console.log(`\nCorrelation [${trace.correlationId}]:`);
      trace.observations.forEach(o => console.log(`  ✓ ${o.layer} at ${o.foundAt.toISOString()}`));
    }
  },

  chaos: async ({ page }, use) => {
    const helper = new ChaosHelper(page);
    await use(helper);
    await helper.restore();
  },

  audit: async ({ request }, use) => {
    await use(new AuditHelper(request));
  },

  db: async ({}, use) => {
    await use(new DatabaseHelper());
  },

  creditApi: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({
      baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
    await use(context);
    await context.dispose();
  },

  guaranteed:   async ({}, use) => { await use(CompanyFactory.guaranteed()); },
  defaulted:    async ({}, use) => { await use(CompanyFactory.defaulted()); },
  ambiguous:    async ({}, use) => { await use(CompanyFactory.ambiguous()); },
  atScoreLimit: async ({}, use) => { await use(CompanyFactory.atScoreLimit()); },
});

export { expect } from '@playwright/test';
