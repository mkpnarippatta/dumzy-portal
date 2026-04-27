# Dumzy Portal

Omni-service concierge — WhatsApp-based AI routing gateway for bike rental, hotel, taxi, ticketing, and social media enquiries.

## Architecture

28 independent Express services organized in 8 epics, mounted behind a single API gateway.

```
                    ┌─────────────┐
                    │   Gateway    │  port 3099
                    │  src/gateway │
                    └──────┬──────┘
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
     ┌──────────┐    ┌──────────┐     ┌──────────┐
     │  1.x     │    │  2.x     │     │  3.x     │
     │ Webhook  │    │ Profile  │     │ Booking  │
     │ & Intent │    │ & History│     │ Flows    │
     └──────────┘    └──────────┘     └──────────┘
     ┌──────────┐    ┌──────────┐     ┌──────────┐
     │  4.x     │    │  5.x     │     │  6.x     │
     │ Handoff  │    │ Data     │     │ Monitor  │
     │ & Agent  │    │ & Backup │     │ & Alerts │
     └──────────┘    └──────────┘     └──────────┘
     ┌──────────┐    ┌──────────┐
     │  7.x     │    │  8.x     │
     │Compliance│    │ Routing  │
     │ & Crypto │    │ & CRM    │
     └──────────┘    └──────────┘
```

### Epics & Services

| Epic | Services | Purpose |
|------|----------|---------|
| **1** | 1-1 through 1-5 | WhatsApp webhook ingestion, AI intent classification, confidence handling, unified dashboard, marketplace routing |
| **2** | 2-1 through 2-3 | Customer profile recognition, conversation history, context-aware booking recommendations |
| **3** | 3-1 through 3-4 | WhatsApp flow framework, bike rental, taxi, hotel booking flows |
| **4** | 4-1 through 4-3 | Seamless handoff trigger, context transfer to agent, agent pool routing |
| **5** | 5-1 through 5-3 | Supabase conversation storage, cross-system data consistency, backup/recovery |
| **6** | 6-1 through 6-3 | API downtime detection and fallback, rate limit monitoring, uptime dashboard |
| **7** | 7-1, 7-2 | WhatsApp template compliance, data protection and encryption |
| **8** | 8-1 through 8-4 | Backend system routing, Odoo CRM lead management, vendor notifications, PMS inventory sync |

## Integration Flows

Four cross-service flows connect the epics end-to-end:

```
Flow 1: Webhook → Classification → Handoff
  1-1 → 1-2 → 1-3 → 4-1 → 4-2 → 4-3

Flow 2: Booking → PMS → Vendor → Odoo
  3-2 → 8-4 → 8-3 → 8-2

Flow 3: Profile → Recommendations → History → Backup
  2-1 → 2-2 → 2-3 → 5-1 → 5-3

Flow 4: Rate Limit → Fallback → Recovery
  6-2 → 6-1 → 6-3
```

## Gateway

All services mount under a single Express gateway (`src/gateway.js`). The gateway:

- Intercepts `/health` and `/api/health` with an aggregated response showing all 28 services
- Mounts static-route services first, then parameterized-route services to prevent shadowing
- Exposes port 3099 (configurable via `PORT` env var)
- Includes a global 404 handler and error middleware

## Testing

```
npm test                  # 1154 unit + integration tests
npm run test:integration  # 4 cross-service flow tests only
```

- **Unit tests**: One file per service, testing classes and endpoints in isolation
- **Integration tests**: 4 flow files in `tests/integration/`, each chaining 4–6 services
- **Shared helpers**: `tests/helpers/setup.js` (MOCHA_TEST_MODE, log suppression), `tests/helpers/fixtures.js` (test data factories)
- **Mocking**: Sinon for stubbing external dependencies (Supabase, APIs)

## Running

```bash
node src/gateway.js              # start on default port
PORT=3099 node src/gateway.js    # start on specific port
```

Requires Node 20+. Set `NODE_ENV=production` for production — all 28 services auto-disable their individual `app.listen()` when detected behind the gateway.

## Environment

Key variables (full list in `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3099 | Gateway port |
| `MOCHA_TEST_MODE` | `false` | Suppresses per-service `app.listen()` |
| `CONFIDENCE_THRESHOLD` | `0.8` | AI classification threshold |
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_KEY` | — | Supabase service role key |
| `ENCRYPTION_KEY` | — | Data encryption key (auto-generated if unset) |
