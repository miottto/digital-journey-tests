import { faker } from '@faker-js/faker/locale/en_US';
import dayjs from 'dayjs';

export interface Company {
  companyId: string;
  companyName: string;
  incorporationDate: string;
  monthlyRevenue: number;
  score: number;
  email: string;
  phone: string;
  owner: {
    name: string;
    taxId: string;
    email: string;
  };
  debtRatio: number;
  isDefaulted: boolean;
}

export const CREDIT_RULES = {
  MIN_DAYS_INCORPORATED: 90,
  MIN_MONTHLY_REVENUE:   10_000,
  MAX_MONTHLY_REVENUE:   1_000_000,
  MIN_SCORE:             300,
  MAX_SCORE:             1000,
  MAX_DEBT_RATIO:        0.6,
  MIN_CREDIT_AMOUNT:     5_000,
  MAX_CREDIT_AMOUNT:     500_000,
} as const;

function generateCompanyId(): string {
  const n = () => faker.number.int({ min: 0, max: 9 });
  const nums = Array.from({ length: 12 }, n);
  return `${nums.slice(0,2).join('')}.${nums.slice(2,5).join('')}.${nums.slice(5,8).join('')}/0001-${nums.slice(8,10).join('')}`;
}

function generateOwnerTaxId(): string {
  const n = () => faker.number.int({ min: 0, max: 9 });
  const nums = Array.from({ length: 9 }, n);
  return `${nums.slice(0,3).join('')}.${nums.slice(3,6).join('')}.${nums.slice(6,9).join('')}-${faker.number.int({ min: 10, max: 99 })}`;
}

function base(overrides: Partial<Company> = {}): Company {
  return {
    companyId:         generateCompanyId(),
    companyName:       `${faker.company.name()} LLC`,
    incorporationDate: dayjs().subtract(faker.number.int({ min: 180, max: 3650 }), 'days').toISOString(),
    monthlyRevenue:    faker.number.int({ min: 50_000, max: 800_000 }),
    score:             faker.number.int({ min: 400, max: 900 }),
    email:             faker.internet.email(),
    phone:             faker.phone.number(),
    owner: {
      name:  faker.person.fullName(),
      taxId: generateOwnerTaxId(),
      email: faker.internet.email(),
    },
    debtRatio:   parseFloat(faker.number.float({ min: 0.1, max: 0.4 }).toFixed(2)),
    isDefaulted: false,
    ...overrides,
  };
}

export const CompanyFactory = {
  guaranteed(): Company {
    return base({
      incorporationDate: dayjs().subtract(2, 'years').toISOString(),
      monthlyRevenue:    300_000,
      score:             750,
      debtRatio:         0.2,
      isDefaulted:       false,
    });
  },
  atScoreLimit(): Company {
    return base({ score: CREDIT_RULES.MIN_SCORE });
  },
  belowScoreLimit(): Company {
    return base({ score: CREDIT_RULES.MIN_SCORE - 1 });
  },
  atIncorporationLimit(): Company {
    return base({
      incorporationDate: dayjs().subtract(CREDIT_RULES.MIN_DAYS_INCORPORATED, 'days').toISOString(),
    });
  },
  belowIncorporationLimit(): Company {
    return base({
      incorporationDate: dayjs().subtract(CREDIT_RULES.MIN_DAYS_INCORPORATED - 1, 'days').toISOString(),
      score:             900,
      monthlyRevenue:    500_000,
    });
  },
  atDebtLimit(): Company {
    return base({ debtRatio: CREDIT_RULES.MAX_DEBT_RATIO });
  },
  overIndebted(): Company {
    return base({ debtRatio: CREDIT_RULES.MAX_DEBT_RATIO + 0.01, score: 800 });
  },
  defaulted(): Company {
    return base({ isDefaulted: true, score: 850 });
  },
  ambiguous(): Company {
    return base({
      score:             310,
      debtRatio:         0.55,
      incorporationDate: dayjs().subtract(95, 'days').toISOString(),
      monthlyRevenue:    12_000,
      isDefaulted:       false,
    });
  },
  multiple(count: number, overrides: Partial<Company> = {}): Company[] {
    return Array.from({ length: count }, () => base(overrides));
  },
};
