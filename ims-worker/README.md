# Atmos — IMS history API (Cloudflare Worker)

This Worker provides historical statistics for the Atmos Android app while keeping the Israel Meteorological Service token out of the public repository and APK.

## Setup (Cloudflare dashboard)
1. Create a Cloudflare Worker named `atmos-ims`.
2. Copy `src/index.js` to its editor and deploy. Alternatively connect this GitHub repository and set root directory to `ims-worker` (Wrangler deployment).
3. Go to Worker > Settings > Variables and Secrets, add **Secret** `IMS_API_TOKEN` with the token privately (do not add it to GitHub).
4. Once deployed, open `https://atmos-ims.<your-subdomain>.workers.dev/api/stations` to verify station results.
5. In Android, go to History, paste the Worker HTTPS base URL (without /api), save it, and press Load stations.

API:
- `GET /api/stations`: station metadata.
- `GET /api/history?station=123&from=2026-10-01&to=2026-10-31`: mean temperatures, humidity, wind, rain, samples and rainy days.
- Date range max 32 calendar days in this initial version.

**Security:** The service is publicly reachable. The IMS token remains server-side but users of the endpoint can consume your IMS quota. For production, add Cloudflare WAF rate limiting, authentication/Cloudflare Access and monitor traffic.

**Scientific note:** Means are arithmetic averages of valid available samples, not quality-controlled climatological normals. Missing data and sample frequency affect the results. Rain channel values are assumed interval precipitation, not running cumulative totals, and should be validated with actual IMS observations before relying on totals.

Reference: https://ims.gov.il/he/ObservationDataAPI
