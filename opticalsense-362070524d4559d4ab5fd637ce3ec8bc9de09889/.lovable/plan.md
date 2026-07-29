## Changes

### 1. Sensors only stream while a test is running
Currently `useLiveSensors(deviceId, true)` in `dashboard.tsx` is always active, so cards animate before Start is pressed and after Stop.

- Change the dashboard to call `useLiveSensors(deviceId, running)`.
- When `running` is false the hook already clears its window and `latest`, so cards render "—" / 0 and the waveform is empty until Start is pressed. On Stop it returns to idle.
- Keep `useSystemStatus()` always on (that's the top status strip, not sensor telemetry).

### 2. Remove the Tests pages
- Delete `src/routes/_authenticated/tests.tsx` and `src/routes/_authenticated/tests.$id.tsx`.
- Remove the "Tests" item from the sidebar nav in `src/components/layout/Sidebar.tsx`.
- Replace any `<Link to="/tests/$id" …>` in `reports.tsx` and `patients.$id.tsx` with a plain non-link label (e.g. show the test date/verdict as text) so nothing points at the removed routes.
- Dashboard's "Generate report from last test" flow is unaffected (it uses the report route, not the test detail page).
- `routeTree.gen.ts` regenerates automatically.

### 3. Deploy split — monorepo + docs (no folder restructure)
Per your answer, keep the current single-project layout and just document how to deploy each half.

- Update `README.md` with a new "Deployment" section:
  - **Frontend on Vercel**: this repo as-is. Vercel auto-detects TanStack Start / Vite. Build command `bun run build`, output handled by the framework preset. Set `VITE_USE_MOCK=true` for a demo deploy, or `VITE_USE_MOCK=false` plus `VITE_API_URL` / `VITE_WS_URL` / `VITE_MQTT_TOPIC_PREFIX` for Live Mode.
  - **Backend on Render (future)**: no backend code exists yet — the `src/services/live/*` stubs are the integration surface. Document the expected Render service shape (Node web service, REST endpoints listed in the README's "Swap points" table, Socket.IO for telemetry, MQTT bridge to HiveMQ). Include the env vars Render would need (`MONGODB_URI`, `JWT_SECRET`, `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`).
  - Note that when the backend is built, it should live in a separate repo (or a `backend/` sibling added later) and the frontend only needs `VITE_API_URL` pointed at the Render URL — no frontend code changes.

## Out of scope
- No new backend code, no folder move, no changes to service interfaces or mock data.
