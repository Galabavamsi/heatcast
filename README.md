# HeatCast

Neighborhood heat scorecard for **FortyGuard Hackathon’26**.

| | |
|---|---|
| **Team** | HumanSlop · **FG-141** |
| **Track** | 1 — urban planning |
| **Deadline** | 30 Aug 2026 |
| **Repo** | [github.com/Galabavamsi/heatcast](https://github.com/Galabavamsi/heatcast) |
| **Local folder** | `D:\fortyguard\heatlens` (product name is HeatCast; folder is still heatlens) |

Draw a US neighborhood, pick a historic hour, **Score area**. You get FortyGuard ~100 m **2 m air** tiles (TCM °C + hours above threshold), CDC/ATSDR SVI, OSM shade/cooling overlays, and a planner brief.

**Living team notes** (status, changelog, who is doing what): [HANDOVER.md](./HANDOVER.md). Update that file whenever you ship or change a decision. This README is the clone-and-run contract.

---

## Honesty (do not weaken for the video)

- FortyGuard is **central**. Tiles are ~100 m neighborhood UHI, not sidewalk CFD.
- Coverage is **United States only**. Area cap **~45 mi²**. Closed GeoJSON polygon. Granularity 60 / 80 / 100 m (we ship **100 m**).
- The canopy slider is a **literature overlay** (~0.015 °C air per 1% canopy, band 0.10–0.20 °C per +10 percentage points, cap 2 °C). It is **not** a new FortyGuard heatmap. Do **not** use LST cooling efficiency (~0.075 °C per 1%).
- `heat_index_celsius` from `env_params` is humidity at a fixed T, not a diurnal comfort curve. Duration = **exceedance hours**. Afternoon comfort chip = **Open-Meteo**.
- Phoenix **`2026-08-17` can complete with 0 tiles and still be billed**. That is a coverage miss, not 0 °C. Demo date: **`2024-07-15 15:00`**.
- Failed FortyGuard tasks are free; **empty successful heatmaps still cost**. Cache AOI + datetime + analytic type.
- OSM libraries / community centres are **not** an official cooling-center registry.
- Shade is OSM building geometry + SunCalc at the scored hour, not a FortyGuard product.

Do **not** expand into India, walking routes / OSRM, bus-stop clones, UTCI, NWS HeatRisk, deck.gl, or a second product. Track 1 examples already include a Cool Route Planner; we are the district scorecard.

---

## Architecture

```
heatlens/
  api/                 FastAPI (port 8000) — FortyGuard, cache, scoring, brief
    app/               routes + domain modules
    fortyguard/        vendored client (adapted from the official SDK)
    cache/             gitignored disk cache
    outputs/           gitignored heat-intelligence PDFs
    tests/
  web/                 Next.js 16 + React 19 + MapLibre 6 (port 3000)
    src/app/page.tsx   shell, Score, brief refresh, layer toggles
    src/components/HeatMap.tsx
    src/lib/           API client, AOI, shade, contours, scenario
  RESEARCH-*.md        product / API locks (read 3D-URBAN, then SIMULATOR)
  HANDOVER.md          living snapshot for both developers
```

```
Browser (localhost:3000)
    → POST /v1/analyze          TCM + exceedance + template memo (no LLM wait)
    → POST /v1/svi              CDC/ATSDR 2022 tracts joined to heat
    → POST /v1/enrich           satellite + env first; streetview/PDF optional
    → GET  /v1/cooling, /v1/buildings
    → POST /v1/brief            DeepSeek (or template) with compact JSON
FortyGuard Premium  ←  api/.env FORTYGUARD_API_KEY only (never NEXT_PUBLIC_*)
```

The Next app talks only to `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`). The FortyGuard key never leaves the API process.

---

## Run locally

Need **Python 3.11+**, **Node 20+**, and a FortyGuard API key.

### 1. API

```powershell
cd D:\fortyguard\heatlens
python -m venv .venv
.\.venv\Scripts\activate
pip install -r api\requirements.txt
copy api\.env.example api\.env
# put FORTYGUARD_API_KEY in api/.env
cd api
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Web

```powershell
cd D:\fortyguard\heatlens\web
npm install
npm run dev
```

Open **http://localhost:3000**. Search a US city, **Draw area** (under 45 mi²), date **2024-07-15**, hour **15:00**, **Score area**. Hard-refresh after `package.json` changes.

### Env (`api/.env` — gitignored)

| Variable | Required | Notes |
|---|---|---|
| `FORTYGUARD_API_KEY` | yes | Server only |
| `FORTYGUARD_BASE_URL` | no | Default `https://api.fortyguard.com` |
| `PORT` | no | Bind `0.0.0.0:$PORT` on Render |
| `LLM_API_KEY` | no | Planner brief; without it, template paragraphs |
| `LLM_BASE_URL` | no | DeepSeek: `https://api.deepseek.com/v1` |
| `LLM_MODEL` | no | This key’s models: **`deepseek-v4-flash`** (default) or `deepseek-v4-pro`. There is no `deepseek-chat`. |

`web/.env.local` (optional): `NEXT_PUBLIC_API_URL=http://localhost:8000`.

Never commit `.env`, `.env.local`, keys, or `api/cache/`.

### Tests

```powershell
cd D:\fortyguard\heatlens\api
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

---

## How to use the map

| Control | Behavior |
|---|---|
| **Pan** | Left-drag pans. Right-drag / Ctrl-drag orbits around the AOI. Scroll zoom always on. |
| **Draw area** | Left-drag a box. Space pans. Scroll still zooms. |
| **Orbit** | Left-drag orbits (`easeTo({ around })` the AOI/heat centroid). Space / middle pans. |
| **Flat / 3D heat** | 3D also extrudes OSM buildings when loaded. |
| **Isolines** | Burned into the heat **canvas**, not a MapLibre fill layer. |
| **SVI** | SVG overlay (CDC/ATSDR 2022). |
| **Shade** | SVG footprints + umbra from OSM + SunCalc. SunCalc v2 returns **degrees**, azimuth clockwise from north. |
| **Cooling** | `react-map-gl` Markers (OSM libraries / community centres). |

**Score area** loads heat first. SVI, satellite enrich, and OSM follow. The planner brief starts as a cite-only template, then rewrites after satellite + SVI land.

Demo presets (also in `api/app/cities.py`): Houston EaDo, Houston Museum District, Phoenix Downtown — all **2024-07-15 15:00**. Houston threshold 35 °C; Phoenix 38 °C.

---

## API (HeatCast FastAPI)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/v1/cities` | Presets + scenario model meta |
| GET | `/v1/geocode` | Nominatim, `countrycodes=us` |
| POST | `/v1/analyze` | TCM + exceedance + scorecard + **template** memo. Must not wait on enrich or LLM. |
| POST | `/v1/brief` | Rewrite planner brief after satellite / SVI / OSM. |
| POST | `/v1/enrich` | Hotspot extras: **satellite + env** (~45 s), then optional streetview / heat-intelligence PDF (~12 s). Fail-open. |
| POST | `/v1/svi` | CDC/ATSDR SVI 2022 tracts, optionally joined to heatmap |
| GET | `/v1/buildings` | OSM footprints (empty FeatureCollection + `meta.error` on Overpass failure, not HTTP 502) |
| GET | `/v1/cooling` | OSM indoor public sites |
| GET | `/v1/osm` | Both OSM layers |
| GET | `/v1/weather` | Open-Meteo rain / heat index + FEMA chip + USGS elevation |
| POST | `/v1/scenario` | Literature ΔT without re-running FortyGuard |
| GET | `/v1/credits` | Key usage, secrets stripped |
| GET | `/v1/outputs/{file}` | Heat-intelligence PDF |

FortyGuard Premium (server-side only): `create_heatmap` `tcm` and `exceedance`; `environmental_parameters`; `satellite_segmentation`; `street_view_segmentation` (often times out); `heat_intelligence` PDF.

Non-FG: Open-Meteo, OSM Overpass (mirrors + disk cache `osm-buildings-v2` / `osm-cooling-v2`), FEMA NFHL, USGS 3DEP, CDC/ATSDR SVI 2022, optional DeepSeek.

---

## Map implementation (do not “simplify”)

Hard-won. Reverting these makes heat/SVI/shade vanish or slide off-screen.

1. Heat fill is a **canvas raster** draped as MapLibre **image** source `heatcast-raster`. Do not redraw heat polygons on every `render`.
2. Camera: do not `flyTo` on every AOI drag. Scroll zoom always on. Draw = left-drag. Space pans.
3. Cyan AOI mask is an **SVG quad** from four `map.project` corners.
4. MapLibre fill/line layers do **not** show reliably on this map. SVI tracts and shade footprints are **SVG overlays**. Isolines are **burned into the heat canvas**. Cooling sites use **react-map-gl Marker**.
5. Native `dragRotate` slides heat off-screen. Custom orbit uses `easeTo({ around })`. `jumpTo` ignores `around`.

Details and the rest of the gotcha list: [HANDOVER.md](./HANDOVER.md).

---

## Deploy (Render)

- One service per process. Bind HTTP to **`0.0.0.0:$PORT`**.
- Filesystem is **ephemeral** — `api/cache` and `api/outputs` die on restart. Freeze demo caches before judging, or accept re-bills.
- Put `FORTYGUARD_API_KEY` and optional `LLM_*` in **server env**, not the frontend.
- Add the public web origin to FastAPI CORS (today localhost-only).
- Set `NEXT_PUBLIC_API_URL` to the public API URL at **build** time for the web service.

---

## Research and product locks

Read in this order:

| File | Role |
|---|---|
| [HANDOVER.md](./HANDOVER.md) | **Living** status, changelog, open work, map gotchas |
| [RESEARCH-3D-URBAN.md](./RESEARCH-3D-URBAN.md) | Current product lock (Track 1). Overrides the HeatHall pivot. |
| [RESEARCH-SIMULATOR.md](./RESEARCH-SIMULATOR.md) | API + scenario formula |
| [RESEARCH-PIVOT.md](./RESEARCH-PIVOT.md) | Superseded Track 3 hero. Keep FG calling rules and date discipline only. |

`D:\fortyguard\temperature-api-quickstart` is **reference only** (notebooks, schema). Do not ship it. Useful later, not clones: persistence heatmap (longest consecutive hours ≥ 35 °C); cause-tagged recs from satellite canopy/impervious. Never treat FG `heat_index_celsius` as a diurnal curve. `env_params` is km-scale — do not rank nearby tracts with it.

---

## Links

- FortyGuard API: https://docs-api.fortyguard.com
- Create heatmap: https://docs-api.fortyguard.com/docs/create-heatmap
- Limitations / billing: https://docs-api.fortyguard.com/docs/limitations
- Hackathon: https://www.fortyguard.com/hackathon26
- Slack: **fortyguardhackthon26** (spelling as on the invite)
- GitHub: https://github.com/Galabavamsi/heatcast
