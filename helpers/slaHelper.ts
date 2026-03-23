import { expect } from '@playwright/test';

export interface SlaDefinition {
  stepName: string;
  maxMs: number;
  warnMs?: number;
}

export interface SlaMeasurement {
  stepName: string;
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
  withinSla: boolean;
  withinWarn: boolean;
}

export const JOURNEY_SLAS = {
  AI_AGENT_DECISION:   { stepName: 'AI agent credit decision',     maxMs: 10_000, warnMs: 7_000  },
  RULES_ENGINE:        { stepName: 'Business rules engine',        maxMs: 2_000,  warnMs: 1_000  },
  WEBHOOK_DISPATCH:    { stepName: 'Webhook dispatch',             maxMs: 5_000,  warnMs: 3_000  },
  EMAIL_DELIVERY:      { stepName: 'Email delivery',               maxMs: 30_000, warnMs: 15_000 },
  SMS_DELIVERY:        { stepName: 'SMS delivery',                 maxMs: 15_000, warnMs: 8_000  },
  CONTRACT_GENERATION: { stepName: 'Contract generation',          maxMs: 8_000,  warnMs: 5_000  },
  PIX_INITIATION:      { stepName: 'Pix payment initiation',       maxMs: 3_000,  warnMs: 1_500  },
} as const;

export class SlaHelper {
  private measurements: SlaMeasurement[] = [];

  async measure<T>(slaKey: keyof typeof JOURNEY_SLAS, fn: () => Promise<T>): Promise<T> {
    const sla = JOURNEY_SLAS[slaKey];
    const startedAt = new Date();
    const start = performance.now();
    const result = await fn();
    const durationMs = Math.round(performance.now() - start);
    const measurement: SlaMeasurement = {
      stepName:   sla.stepName,
      durationMs,
      startedAt,
      completedAt: new Date(),
      withinSla:  durationMs <= sla.maxMs,
      withinWarn: sla.warnMs ? durationMs <= sla.warnMs : true,
    };
    this.measurements.push(measurement);
    if (!measurement.withinWarn && measurement.withinSla) {
      console.warn(`⚠️  SLA warning: "${sla.stepName}" took ${durationMs}ms (warn: ${sla.warnMs}ms, hard limit: ${sla.maxMs}ms)`);
    }
    return result;
  }

  assertWithinSla(slaKey: keyof typeof JOURNEY_SLAS): void {
    const sla = JOURNEY_SLAS[slaKey];
    const m = this.measurements.find(m => m.stepName === sla.stepName);
    if (!m) throw new Error(`No SLA measurement found for "${sla.stepName}". Did you call measure() first?`);
    expect(
      m.durationMs,
      `SLA BREACH: "${sla.stepName}" took ${m.durationMs}ms, expected ≤ ${sla.maxMs}ms.`
    ).toBeLessThanOrEqual(sla.maxMs);
  }

  assertAllWithinSla(): void {
    const breaches = this.measurements.filter(m => !m.withinSla);
    if (breaches.length > 0) {
      const details = breaches.map(m => `  - "${m.stepName}": ${m.durationMs}ms`).join('\n');
      throw new Error(`SLA breaches detected:\n${details}`);
    }
  }

  getSummary(): SlaMeasurement[] { return [...this.measurements]; }
  reset(): void { this.measurements = []; }
}
