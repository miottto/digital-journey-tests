# digital-journey-tests

![CI](https://img.shields.io/badge/CI-passing-brightgreen?logo=github)
![Tests](https://img.shields.io/badge/tests-70%20passing-brightgreen)
![Stack](https://img.shields.io/badge/stack-Playwright%20%7C%20TypeScript%20%7C%20PostgreSQL%20%7C%20Google%20ADK-blue)
![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-blueviolet?logo=anthropic)

**Author:** Luiz Gustavo Miotto · [LinkedIn](https://www.linkedin.com/in/miottto)

> **API-level** automated test suite for digital communication journeys — chatbot qualification, credit decisioning, email and SMS notifications, and Pix disbursement.
> Tests interact directly with HTTP endpoints and assert against PostgreSQL. The `ai-agent` layer also drives the ADK Web UI to validate the real Gemini agent end-to-end.

---

## The journey

A company requests credit. An AI agent classifies the intent, the rules engine decides, and the outcome — approval or rejection — triggers notifications and, if approved, a Pix disbursement. A single `correlationId` threads through every step of the chain.

```mermaid
flowchart TD
    A([Company requests credit]):::start --> B["POST /credit-requests"]:::api
    B --> C["POST /chatbot/message"]:::api
    C --> C1["Mock Adapter<br/>keyword deterministic"]:::mock
    C --> C2["Gemini ADK<br/>real AI agent"]:::ai
    C1 --> D["Rules engine<br/>score · limit · default status"]:::engine
    C2 --> D
    D --> E{Decision}:::decision
    E -->|Approved| F["Webhook → ERP<br/>correlationId propagated"]:::approved
    E -->|Rejected| G["Email + SMS<br/>rejection notification"]:::rejected
    F --> H["POST /notifications/email<br/>POST /notifications/sms"]:::notify
    H --> I["POST /credit-requests/:id/disburse<br/>Pix — SLA ≤ 3s BCB"]:::pix
    I --> J([Journey complete — full audit trail recorded]):::finish

    classDef start    fill:#4ade80,stroke:#16a34a,color:#000
    classDef api      fill:#60a5fa,stroke:#2563eb,color:#000
    classDef mock     fill:#a78bfa,stroke:#7c3aed,color:#000
    classDef ai       fill:#a78bfa,stroke:#7c3aed,color:#000
    classDef engine   fill:#fb923c,stroke:#ea580c,color:#000
    classDef decision fill:#fbbf24,stroke:#d97706,color:#000
    classDef approved fill:#34d399,stroke:#059669,color:#000
    classDef rejected fill:#f87171,stroke:#dc2626,color:#000
    classDef notify   fill:#60a5fa,stroke:#2563eb,color:#000
    classDef pix      fill:#818cf8,stroke:#4f46e5,color:#000
    classDef finish   fill:#4ade80,stroke:#16a34a,color:#000
```

> *Each step in the journey is tested in isolation by design — enabling precise failure diagnosis, parallel execution, and independent SLA measurement. The `ai-agent` layer validates the Gemini agent separately via the ADK Web UI.*

---

## Test layers

| Layer | Tests | What it validates |
|---|---|---|
| journeys | 34 | Real user flows — creation, chatbot, notifications, disbursement, webhook to ERP |
| strategy | 8 | Business boundaries, idempotency, retry storms |
| chaos | 10 | Graceful degradation — 503, malformed payloads, concurrent requests |
| observability | 10 | Per-step SLA, correlationId across all layers, audit trail |
| ai-agent | 8 | Real Gemini agent via ADK Web UI — intent classification, data extraction, session context |
| **Total** | **70** | |

---

## Why this suite is built this way

**On test strategy** — business rules are validated at exact boundaries. `score=300` approves, `score=299` rejects. `requestedAmount=5000` is accepted, `4999` is not. A test that misses by one unit misses the bug entirely.

**On chaos engineering** — each chaos scenario maps to a real production incident: email service returning 503, a null body leaking a stack trace, concurrent disbursements creating duplicate records. Chaos tests have zero retries by design. A test that passes on retry is not a green test — it is a masked failure.

**On observability** — a `correlationId` is generated at the start of every journey and must appear in the API response, the database record, every audit event, and every notification. SLA assertions go further: the Pix disbursement must complete in under 3 seconds, not because we chose that number, but because the Brazilian Central Bank mandates it.

**On the AI adapter** — the `ChatbotAdapter` switches between the real Gemini agent and a deterministic mock via a single environment variable. CI always runs with the mock — fast, free, non-flaky. The `ai-agent` Playwright project is the only layer that targets the real Gemini endpoint, driving the ADK Web UI directly at `localhost:8000`.

**On infrastructure choices** — notifications are validated directly in PostgreSQL rather than through Mailosaur or Twilio. This eliminates external dependencies, keeps CI free and fast, and produces more precise assertions — the exact recipient, subject and correlationId stored in the database, not just whether an inbox received something.

---

## Infrastructure

```mermaid
flowchart TB
    subgraph LOCAL["Local Machine"]
        subgraph DOCKER["Docker"]
            PG[("PostgreSQL 13 · journey_db · port 5432<br/>credit_requests · audit_events<br/>notifications · disbursements")]:::infra
        end

        subgraph API["Express API — server.ts"]
            Routes["port 3000<br/>POST /credit-requests · GET /credit-requests/:id<br/>POST /chatbot/message<br/>POST /notifications/email · POST /notifications/sms<br/>POST /credit-requests/:id/disburse · POST /credit-requests/:id/webhook<br/>GET /audit/credit-requests/:id/events"]:::app
            Adapter["ChatbotAdapter<br/>USE_AI_AGENT=true → Google ADK (Gemini)<br/>USE_AI_AGENT=false → Deterministic mock"]:::app
        end

        subgraph ADK["ADK Web UI — port 8000"]
            AgentUI["adk web chatbot/agent.ts<br/>Gemini agent · real API calls"]:::ai
        end

        subgraph TESTS["Playwright Test Suite"]
            J["journeys/<br/>34 tests"]:::tests
            S["strategy/<br/>8 tests"]:::tests
            C["chaos/<br/>10 tests · retries = 0"]:::chaos
            O["observability/<br/>10 tests"]:::tests
            AI["ai-agent/<br/>8 tests · headless: false"]:::ai
            Fixtures["slaHelper · chaosHelper · correlationHelper<br/>auditHelper · db-helper · CompanyFactory · adkHelper"]:::tests
        end

        subgraph REPORTS["Reports"]
            HTML["Playwright HTML Report<br/>playwright-report/"]:::reports
            Allure["Allure Report<br/>allure-report/"]:::reports
        end
    end

    subgraph CI["GitHub Actions"]
        CIJ["journeys<br/>every PR"]:::ci
        CIS["strategy<br/>every PR"]:::ci
        CIC["chaos<br/>main + nightly"]:::ci
        CIO["observability<br/>every PR"]:::ci
        CIAI["ai-agent<br/>manual / local only"]:::ci
        Pages["Allure → GitHub Pages<br/>merge to main"]:::ci
    end

    Gemini(["Google Gemini API<br/>USE_AI_AGENT=true · local dev only"]):::external

    TESTS -->|"HTTP requests + DB assertions"| API
    AI -->|"UI automation"| ADK
    API -->|"SQL queries"| DOCKER
    Adapter -.->|"optional"| Gemini
    ADK -.->|"real calls"| Gemini
    TESTS --> REPORTS
    CI -->|"triggers"| TESTS

    classDef infra    fill:#F5F0E8,stroke:#8C7B6B,color:#4A3F35
    classDef app      fill:#E8F0F8,stroke:#4A7FA5,color:#1C4F72
    classDef tests    fill:#EAF3DE,stroke:#5A8A3A,color:#2D5A1A
    classDef chaos    fill:#FCEBEB,stroke:#A32D2D,color:#791F1F
    classDef ai       fill:#F0ECF8,stroke:#6B52A8,color:#3D2B7A
    classDef ci       fill:#FAEEDA,stroke:#854F0B,color:#633806
    classDef external fill:#F0ECF8,stroke:#6B52A8,color:#3D2B7A
    classDef reports  fill:#F1EFE8,stroke:#5F5E5A,color:#444441
```

---

## How to run

```bash
# Setup
git clone https://github.com/miottto/digital-journey-tests
cd digital-journey-tests
npm install && npx playwright install chromium
cp .env.example .env
docker-compose up -d

# Run all tests (including AI agent — requires GEMINI_API_KEY)
npm run test:all

# Run all tests except AI agent
npx playwright test

# Run by layer
npm run test:journeys
npm run test:strategy
npm run test:chaos
npm run test:observability

# Run AI agent tests (requires GEMINI_API_KEY, starts ADK Web UI automatically)
npm run test:ai-agent

# Start ADK Web UI manually (port 8000, kills previous instance first)
npm run adk-web

# Reports
npx playwright show-report
npm run report:allure
```

---

## Stack

| Tool | Purpose |
|---|---|
| Playwright | API automation — HTTP requests and assertions |
| TypeScript | Strict typing across the suite |
| PostgreSQL (Docker) | Real DB assertions on every write |
| Google ADK | Gemini-powered chatbot agent |
| Allure Report | Timeline, traceability, flakiness detection |
| GitHub Actions | Per-layer CI with nightly chaos runs |
| Claude Code | AI pair programmer used throughout development |

---

## Documentation

- [`docs/test-plan.md`](docs/test-plan.md) — Test plan for the credit journey
