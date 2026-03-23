# Test Plan — Digital Credit Journey

**Project:** digital-journey-tests
**Version:** 1.4
**Date:** 2026-03-22
**Author:** Luiz Gustavo Miotto
**Scope:** REST API + PostgreSQL database + ADK Web UI (AI agent layer)
**Total tests:** 70

---

## 1. Objective

Ensure the complete credit request journey works correctly across all relevant scenarios — happy path, business rule boundaries, service failures, and end-to-end traceability.

---

## 2. Scope

### In scope
- REST API endpoints (`server.ts`)
- AI agent integration (chatbot)
- Database persistence (direct SQL assertions)
- Email and SMS notifications
- Pix disbursement
- `correlationId` traceability
- Per-step SLA

### Out of scope
- ADK Web UI internal rendering (only interaction and assertions are tested, not layout)
- Real Pix payment gateway integration (simulated)
- Real email/SMS provider integration (simulated)
- Rules engine end-to-end decisions (score, debt ratio, incorporation date — tests force status via SQL; engine logic is covered by unit tests outside this suite)

---

## 3. General acceptance criteria

- All endpoints return correct HTTP status codes
- Every database write is asserted via SQL, not only through the API response
- `correlationId` must be present in the response header, response body, `credit_requests` table, and `audit_events` table
- The audit trail must record events with correct actors and state transitions
- No chaos test may have retries — a failure on the first retry indicates a masked bug

---

## 4. Test cases

### 4.1 Credit request creation

| ID | Scenario | Input | Expected result | HTTP status |
|---|---|---|---|---|
| CT-001 | Valid request — happy path | Company with score 800, amount R$ 50,000 | Record created in DB with `status: PENDING_ANALYSIS` | 201 |
| CT-002 | Amount one below minimum boundary | `requestedAmount: 4999` | Validation error with descriptive message | 422 |
| CT-003 | Amount one above maximum boundary | `requestedAmount: 500001` | Validation error with descriptive message | 422 |
| CT-004 | Amount exactly at minimum boundary | `requestedAmount: 5000` | Request accepted | 201 |
| CT-005 | Amount exactly at maximum boundary | `requestedAmount: 500000` | Request accepted | 201 |
| CT-006 | Duplicate active request | Same company with an open request | Conflict — second request not created | 409 |
| CT-007 | New request allowed after rejection | Same company, previous request is REJECTED | Second request accepted (409 guard is status-aware) | 201 |
| CT-008 | Retrieve existing credit request | `GET /credit-requests/:id` for a known ID | Returns correct data with `status: PENDING_ANALYSIS` | 200 |
| CT-009 | Retrieve non-existent credit request | `GET /credit-requests/non-existent-id` | Resource not found | 404 |
| CT-010 | Null or malformed body | `null` or invalid JSON | Error response with no stack trace leak | 400 |
| CT-011 | Wrong field type | `requestedAmount: "not-a-number"` | Validation rejects with 422, not 500 | 422 |
| CT-012 | Required fields missing | Body without `companyId`, `email`, or `requestedAmount` | Validation error with descriptive message | 422 |
| CT-051 | Amount well below minimum — journey validation | `requestedAmount: 1000` | Validation error with descriptive message | 422 |
| CT-052 | Amount well above maximum — journey validation | `requestedAmount: 999999` | Validation error with descriptive message | 422 |

---

### 4.2 Chatbot — intent classification

| ID | Scenario | Input | Expected result |
|---|---|---|---|
| CT-014 | Credit request intent | Message with amount and purpose | `intent: REQUEST_CREDIT`, `confidence ≥ 0.8` |
| CT-015 | Request tracking intent | Message with request ID | `intent: TRACK_REQUEST` |
| CT-016 | Out of scope | Message unrelated to credit | `intent: OUT_OF_SCOPE` |
| CT-017 | Human handoff request | Message asking to speak with a person | `intent: SPEAK_TO_HUMAN` |
| CT-018 | Missing message field | Body without `message` | Validation error | 422 |
| CT-019 | sessionId auto-generated | Request without `sessionId` | Response contains a generated `sessionId` | 200 |
| CT-020 | companyId extracted from message | Message containing a company identifier | `collectedData.companyId` populated in response | 200 |
| CT-053 | correlationId propagation through chatbot | `x-correlation-id` header sent on request | Same ID echoed in response header and `correlationId` body field | 200 |

---

### 4.3 Chaos — service failures and resilience

| ID | Scenario | Input | Expected result |
|---|---|---|---|
| CT-021 | Email service returns 503 | Journey does not stall; failure isolated | Graceful degradation |
| CT-022 | SMS gateway returns 503 | System handles failure without stalling | Graceful degradation |
| CT-023 | Chatbot returns 500 | AI service responds with internal error | Structured error response — server does not crash |
| CT-024 | Empty message body | `message: ""` | Graceful handling — no 500 or unhandled exception |
| CT-025 | Extremely long message | Message with thousands of characters | Request completes without crash or timeout |
| CT-026 | Disbursement on non-approved request | `POST /credit-requests/:id/disburse` when status ≠ APPROVED | Structured 422, not 500 |
| CT-027 | Concurrent disbursement attempts | Two simultaneous `POST /credit-requests/:id/disburse` | No duplicate records created; idempotency preserved |
| CT-028 | Webhook — ERP not configured | `ERP_WEBHOOK_URL` is unset | Returns 200, records `WEBHOOK_FAILED` audit event; request is not stalled |

---

### 4.4 Notifications (email and SMS)

| ID | Scenario | Expected result | HTTP status |
|---|---|---|---|
| CT-029 | Email — delivery and persistence | Record in `notifications` with `type: email`, `status: DELIVERED` | 200 |
| CT-030 | SMS — delivery and persistence | Record in `notifications` with `type: sms`, `status: DELIVERED` | 200 |
| CT-031 | Email — required fields missing | Body without `to` or `subject` | Validation error | 422 |
| CT-032 | SMS — required fields missing | Body without `to` or `message` | Validation error | 422 |
| CT-054 | Email — correlationId from body used | Request body includes `correlationId`; no header sent | Body correlationId persisted to `notifications.correlation_id` | 200 |
| CT-055 | Email — correlationId echoed in response header | `x-correlation-id` header sent on request | Same ID present in response header | 200 |
| CT-056 | SMS — correlationId from body used | Request body includes `correlationId`; no header sent | Body correlationId persisted to `notifications.correlation_id` | 200 |

---

### 4.5 Pix disbursement

| ID | Scenario | Expected result | HTTP status |
|---|---|---|---|
| CT-033 | Disbursement on approved request | Record in `disbursements`, `status: COMPLETED` | 200 |
| CT-034 | Disbursement on non-existent request | Resource not found | 404 |
| CT-035 | Disbursement without pixKey | Body missing `pixKey` field | Validation error | 422 |
| CT-057 | Disbursement on non-approved request — journey layer | `POST /credit-requests/:id/disburse` when status is `PENDING_ANALYSIS` | Structured 422: "Only approved credit requests can be disbursed." | 422 |
| CT-058 | Disbursement — correlationId propagation | `x-correlation-id` header sent on request | Same ID echoed in response header and `correlationId` body field | 201 |

---

### 4.6 Webhook to ERP

| ID | Scenario | Expected result | HTTP status |
|---|---|---|---|
| CT-059 | Webhook on approved request — happy path | Audit event recorded (`WEBHOOK_DISPATCHED` or `WEBHOOK_FAILED`); actor = `api/webhook`; `correlationId` present in response | 200 |
| CT-060 | Webhook — correlationId propagation | `x-correlation-id` header echoed in response header, response body, and webhook audit event | 200 |
| CT-061 | Webhook on non-approved request | Structured validation error | 422 |
| CT-062 | Webhook for non-existent credit request | Resource not found | 404 |

---

### 4.7 Traceability — correlationId

| ID | Scenario | Expected result |
|---|---|---|
| CT-036 | ID propagated to response | `x-correlation-id` in header + `correlationId` in body |
| CT-037 | ID propagated to database | `credit_requests.correlation_id` = sent ID |
| CT-038 | ID propagated to audit_events | All events for the request share the same ID |
| CT-039 | ID propagated to notifications | `notifications.correlation_id` = original ID |
| CT-040 | ID propagated to disbursements | `disbursements.correlation_id` = original ID |
| CT-041 | Unique IDs per request | Two requests generate distinct IDs |

---

### 4.8 Audit trail

| ID | Scenario | Expected result |
|---|---|---|
| CT-042 | Creation event recorded | `CREDIT_REQUEST_CREATED` event exists with correct actor, `new_state: PENDING_ANALYSIS` |
| CT-043 | PIX_INITIATED event recorded | `PIX_INITIATED` event exists after disbursement with correct actor and state transition |
| CT-044 | Events ordered chronologically | `created_at` timestamps are non-decreasing across all audit events for a request |

---

### 4.9 Per-step SLA

| ID | Step | Max SLA |
|---|---|---|
| CT-045 | Credit request creation (POST) | 2s |
| CT-046 | AI agent decision | 10s |
| CT-047 | Webhook dispatch | 5s |
| CT-048 | Email delivery | 30s |
| CT-049 | SMS delivery | 15s |
| CT-050 | Pix initiation | 3s (BCB mandate) |

---

### 4.10 AI agent — Gemini via ADK Web UI

> These tests run against the real Gemini agent (`USE_REAL_AI=true`) through the ADK Web UI at `localhost:8000`. They require `GEMINI_API_KEY` and are excluded from CI — manual or local execution only.

| ID | Scenario | Input | Expected result |
|---|---|---|---|
| CT-063 | Intent classification — REQUEST_CREDIT | Message expressing intent to request credit | Agent classifies as `REQUEST_CREDIT`, asks for amount and purpose |
| CT-064 | Intent classification — TRACK_REQUEST | Message asking for status of existing request | Agent classifies as `TRACK_REQUEST`, asks for request ID |
| CT-065 | Intent classification — SPEAK_TO_HUMAN | Message requesting to speak with a person | Agent classifies as `SPEAK_TO_HUMAN`, acknowledges handoff |
| CT-066 | Intent classification — OUT_OF_SCOPE | Message unrelated to credit (e.g. weather) | Agent classifies as `OUT_OF_SCOPE`, responds appropriately |
| CT-067 | companyId collection | Message containing a company identifier | Agent extracts `companyId` from message and stores in session |
| CT-068 | Ambiguous message handling | Vague or incomplete message | Agent asks a clarifying question, does not crash |
| CT-069 | Session context preserved | Follow-up message in same session | Agent uses prior turn context to give a coherent response |
| CT-070 | JSON response format | Any valid message | Agent response contains valid structured JSON with `intent` field |

---

## 5. Business rules under test

| Rule | Value |
|---|---|
| Minimum requested amount | R$ 5,000 |
| Maximum requested amount | R$ 500,000 |

> **Note:** Score boundaries, debt ratio, and incorporation date rules are enforced by the rules engine. The integration suite does not exercise these end-to-end (status is forced via SQL in tests). These boundaries are validated at the unit level outside this suite.

---

## 6. Execution strategy

| Environment | Configuration | Notes |
|---|---|---|
| Local | `USE_REAL_AI=false`, local server, Docker | Reuses existing server if running |
| Local — AI agent | `USE_REAL_AI=true`, `GEMINI_API_KEY` required, ADK Web UI on port 8000 | `npm run test:ai-agent`; headed browser; manual only |
| CI (pull request) | `USE_REAL_AI=false`, workers = 2, retries = 1 | Chaos layer does not run on PRs |
| CI (main / nightly) | `USE_REAL_AI=false`, chaos retries = 0 | Chaos runs only on push to main or nightly schedule |

---

## 7. Automatically generated evidence

- **Playwright HTML Report** — `playwright-report/` — available via `npx playwright show-report`
- **Allure Report** — `allure-results/` — published to GitHub Pages after each run on `main`
- **Trace on retry** — `.zip` files collected automatically on failure
- **Screenshots / videos** — retained on failure only
