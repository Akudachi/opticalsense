# OpticalSense

Cloud-based dental **optical pulp vitality monitoring** — a clinical workspace
that pairs with an ESP32 optical sensor to capture Red/IR PPG telemetry,
compute SpO₂ / pulse / temperature / signal quality / measurement confidence,
and generate clinic-branded PDF reports.

## Demo Mode vs Live Mode

The app ships with **Demo Mode ON by default** — everything works with no
hardware, backend, database, or MQTT broker. Toggle via env:

| Variable | Demo | Live |
|---|---|---|
| `VITE_USE_MOCK` | `true` | `false` |

The mode switch is enforced by **`src/services/index.ts`**, which returns
either the `mock/*` or `live/*` implementation of each interface in
`src/services/interfaces.ts`. UI code depends only on interfaces.

### Swap points for going Live

| Interface | Live implementation to write |
|---|---|
| `IAuthService` | `fetch(API_URL + "/auth/login")` + JWT + refresh |
| `IPatientService` / `ITestService` / `IReportService` / `IDeviceService` / `IClinicService` / `IActivityService` | `fetch(API_URL + "/<resource>")` |
| `ISensorStream` | Socket.IO client subscribing to backend, backend bridges MQTT topic `${VITE_MQTT_TOPIC_PREFIX}/${deviceId}/telemetry` from HiveMQ Cloud |

Nothing above the service layer changes.

## Stack

- Frontend: **TanStack Start** (React 19, TypeScript, Vite 7) — production
  substitute for the requested Next.js 15 App Router (Next.js is not
  available on this template).
- Styling: **Tailwind v4** + **shadcn/ui** + custom glass tokens.
- Data: **TanStack Query** with a swap-ready service layer.
- Forms: **React Hook Form** + **Zod**.
- Charts: **Recharts**. PDFs: **jsPDF** + `jspdf-autotable`.
- Animation: **Framer Motion**.

## Environment

Copy `.env.example` → `.env` (and optionally `.env.local.example` → `.env.local`)
before running Live Mode. Demo Mode needs no env at all.

All env access flows through **`src/config/env.ts`** — never read
`import.meta.env` elsewhere.

## Scripts

```bash
bun install
bun run dev
```

## Architecture map

```
src/
  config/         env, constants
  types/          domain types
  services/
    interfaces.ts        # UI contracts
    mock/                # Demo implementations
    live/                # Live stubs (throw NotImplemented)
    index.ts             # factory picks mock/live from env.USE_MOCK
  data/seed.ts    # realistic seeded patients, tests, reports, devices
  contexts/       AuthContext, ThemeContext
  hooks/          useLiveSensors, useDebounce
  components/
    brand/  common/  dashboard/  layout/  patients/
  routes/
    __root.tsx  index.tsx  login.tsx
    _authenticated.tsx
    _authenticated/
      dashboard.tsx  patients.tsx  patients.$id.tsx
      tests.tsx      tests.$id.tsx
      reports.tsx    devices.tsx   settings.tsx
  utils/          format, pdf, validators
```

## Multi-clinic / multi-device / AI hooks

All domain types carry `clinicId` and (where relevant) `deviceId`. The
sensor stream is keyed by `deviceId`. `IReportService.generate()` accepts an
optional AI analysis field; the reports UI already renders it.

## Demo seed

- 12 realistic patients with clinical notes and tooth-of-interest
- ~30 historical tests with saved PPG samples + observations + verdicts
- 18 reports (including a couple with AI analysis)
- 2 devices (one online, one offline)
- 1 clinic profile pre-filled — appears in every generated PDF

Demo credentials on the login page: `doctor@opticalsense.io` / `demo1234`.

## Deployment

The app is split into two independently deployable halves. The frontend
lives in this repo; the backend is a separate service you build against
the interfaces in `src/services/interfaces.ts`.

### Frontend → Vercel

This repo deploys as-is — no folder move needed.

1. Import the repo in Vercel. It auto-detects TanStack Start / Vite.
2. Build command: `bun run build` (or `npm run build`). Output is
   handled by the framework preset.
3. Environment variables:
   - **Demo deploy** (no backend needed):
     - `VITE_USE_MOCK=true`
   - **Live deploy** (talks to the Render backend):
     - `VITE_USE_MOCK=false`
     - `VITE_API_URL=https://<your-backend>.onrender.com`
     - `VITE_WS_URL=wss://<your-backend>.onrender.com`
     - `VITE_MQTT_TOPIC_PREFIX=opticalsense`

Switching between Demo and Live requires zero code changes — only env vars.

### Backend → Render (separate repo/service, to be built)

No backend code ships in this repo yet. The `src/services/live/*` stubs
are the integration surface — implement each one against your Render
service. Expected shape:

- **Runtime**: Node.js Web Service on Render.
- **HTTP**: REST endpoints matching the "Swap points" table above
  (`/auth/login`, `/patients`, `/tests`, `/reports`, `/devices`,
  `/clinics`, `/activity`).
- **Realtime**: Socket.IO server that subscribes to MQTT topic
  `${MQTT_TOPIC_PREFIX}/${deviceId}/telemetry` on HiveMQ Cloud and
  fans out telemetry to browser clients.
- **Auth**: JWT access + refresh; frontend stores tokens per
  `src/services/live/services.ts`.

Render env vars the backend will need:

```
PORT=10000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
MQTT_URL=mqtts://<cluster>.hivemq.cloud:8883
MQTT_USERNAME=...
MQTT_PASSWORD=...
MQTT_TOPIC_PREFIX=opticalsense
CORS_ORIGIN=https://<your-vercel-app>.vercel.app
```

When the backend exists, point `VITE_API_URL` / `VITE_WS_URL` at the
Render URL and set `VITE_USE_MOCK=false`. No frontend code changes.

### Infra summary

- Frontend → Vercel
- Backend → Render (separate repo)
- MQTT → HiveMQ Cloud (TLS on 8883)
- DB → MongoDB Atlas

