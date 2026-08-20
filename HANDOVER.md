# HeatCast handover

Standalone context for the next person or agent. Repo: `D:\fortyguard\heatlens`.  
**FortyGuard Hackathon’26 · Team HumanSlop · FG-141 · deadline 30 Aug 2026.**

Do **not** commit secrets. `FORTYGUARD_API_KEY` (and any LLM key) live only in `heatlens/api/.env`.

---

## What this is

**HeatCast** is a Track 1 urban-planner simulator: score a Houston (or Phoenix) district on FortyGuard **2 m air** tiles, then estimate what extra tree canopy *might* do using a **labeled literature overlay**.

- **2D** is the scorecard (choropleth of TCM °C or exceedance hours).
- **3D** is pitched OSM building massing for site context — not a digital twin of shade physics.
- Tiles are **~100 m**. Neighborhood UHI, not sidewalk CFD.

Product name in the UI is HeatCast. The folder is still `heatlens`.

---

## What this is not (do not pitch these)

| Tempting claim | Why not |
|---|---|
| Walking / cool routes / A→B | Official Track 1 examples already include Cool Route Planner. We are the district scorecard + overlay, not a router. |
| India / non-US AOIs | FortyGuard heatmap coverage is **United States only**. |
| “FortyGuard simulated adding trees” | FG has **no** what-if heatmap. The slider does **not** call the API again. |
| HeatHall / data-center flood screener | Earlier pivot (`RESEARCH-PIVOT.md`) was Track 3 industrial siting. **Overridden** by Track 1 urban planning (`RESEARCH-3D-URBAN.md`). |
| Photoreal shade / tree canopies / facade CFD | OSM boxes + optional future suncalc ≠ FG-measured shade. |

---

## Demo cities and dates

API is USA-only. Presets in `api/app/cities.py`:

| District | `city_id` | Date / time | Notes |
|---|---|---|---|
| Houston EaDo | `houston-eado` | **2024-07-15 15:00** | Default. Hotter fabric, construction / outdoor-work story. Threshold 35 °C. |
| Houston Museum District | `houston-museum` | same | Greener contrast tract. Same day. |
| Phoenix Downtown | `phoenix-downtown` | **2024-07-15 15:00** | Historic summer **only**. Threshold 38 °C. |

**Phoenix `2026-08-17` can complete with 0 tiles and still be billed.** Treat that as a coverage miss, never as 0 °C. Failed FG tasks are free; **empty successful heatmaps still cost**. Cache key is AOI + datetime + analytic_type.

---

## Architecture

```
heatlens/
  api/          FastAPI — FortyGuard client, cache, scoring, memo
  web/          Next.js 16 + MapLibre 6 — planner UI
  RESEARCH-*.md product / API lock notes
```

- **Key stays on the server.** `api/.env` → `FORTYGUARD_API_KEY`. Never `NEXT_PUBLIC_*`. The Next app talks only to `http://localhost:8000`.
- Optional: `LLM_API_KEY` or `OPENAI_API_KEY` for the planner brief; else a template paragraph.
- Vendored client: `api/fortyguard/` (copied/adapted from the official SDK).
- **`D:\fortyguard\temperature-api-quickstart` is reference only** (notebooks, parcel examples, schema). Do not ship that fork as the product. Do not point the UI at it.

Disk cache: `api/cache/*.json`. Outputs (heat-intelligence PDFs): `api/outputs/`. Both are local; Render’s filesystem is ephemeral if you deploy there.

---

## Endpoints we actually use

HeatCast FastAPI (`api/app/main.py`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/v1/cities` | Presets + scenario model meta |
| POST | `/v1/analyze` | TCM heatmap + exceedance + scorecard + memo (heatmap must not wait on enrich) |
| POST | `/v1/enrich` | Hotspot extras — 20 s timeout each, parallel, fail-open |
| GET | `/v1/buildings` | OSM Overpass footprints |
| GET | `/v1/weather` | Open-Meteo rain + FEMA chip + USGS elevation |
| POST | `/v1/scenario` | Literature ΔT without re-running FG |
| GET | `/v1/credits` | Key usage (stripped of secrets) |
| GET | `/v1/outputs/{file}` | Heat-intelligence PDF download |

FortyGuard Premium (server-side only):

| Call | Role | Honesty |
|---|---|---|
| `create_heatmap` `analytic_type=tcm` | Snapshot °C polygons (`average_temperature` / min / max) | 100 m, filter_type=1, hour from UI |
| `create_heatmap` `analytic_type=exceedance` | Hours above threshold (`properties.value`) | Duration story. `direction=above` |
| `environmental_parameters` | Wet-bulb, apparent temp, RH, precip at a **point** | Coarse (~1 km). `heat_index_celsius` is **not** duration |
| `satellite_segmentation` | Land-cover class mix at hotspot | `tree`/`plant` ≈ canopy; not a canopy raster for the whole AOI |
| `street_view_segmentation` | Ground-level class mix | Often **times out**; never block analyze |
| `heat_intelligence` | PDF report | Saved under `api/outputs/` |

Non-FG:

- **Open-Meteo** archive/forecast precip — rain chip, not a hydro model.
- **OSM Overpass** buildings — 3D massing; default height 9 m if untagged.
- **FEMA NFHL** flood zone — chip only.
- **USGS 3DEP EPQS** — one elevation point.

---

## Tree slider (must stay labeled)

`api/app/scenario.py` / UI “Add trees (model)”:

- **+10% / +20% canopy** (percentage points), current + added capped at 80%.
- ΔT band **0.10–0.20 °C per +10% canopy**, central 0.15 °C / 10%, **cap 2 °C**.
- Map overlay = existing GeoJSON temperatures minus ΔT. **Not a new FortyGuard heatmap.**
- Hours saved is a fraction of exceedance hours, not a second FG run.

UI copy already says this. Do not weaken it for the video.

---

## How to run (both servers)

API key in `heatlens/api/.env` as `FORTYGUARD_API_KEY` (gitignored).

```powershell
cd D:\fortyguard\heatlens
.\.venv\Scripts\activate
cd api
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

```powershell
cd D:\fortyguard\heatlens\web
npm run dev
```

Open http://localhost:3000. Score **Houston EaDo** or **Museum District** on **2024-07-15 15:00**. Analyze does not wait for enrich.

---

## Known bugs / gotchas

1. **Heatmap fill vs legend (high priority).** Legend and hotspot marker are React (`activeHeat.features.length`, HTML `<Marker>`). They can show “FortyGuard °C · 273 tiles” + a 37 °C pin while MapLibre **fill is blank**. Causes seen in this repo: GeoJSON sources baked into `mapStyle` as empty collections then `setData` (react-map-gl style diffs can wipe data); fill sitting under raster or under 3D buildings; interpolate ramps that collapse a 34.7–36.9 °C payload into one muddy color; Carto dark / OpenFreeMap vector basemaps failing. **Current fix (shipped in `web/src/components/HeatMap.tsx`):** raster-only style (Carto `light_all`, Esri fallback); `<Source>` / `<Layer>` choropleth **above** the raster; per-payload yellow→red stretch; opacity ~0.72; tile outlines; `fitBounds` to AOI; when pitched, 5 m heat slabs so buildings do not fully hide the carpet. Re-check Museum District + Snapshot °C after a refresh.
2. **Enrich timeouts** — streetview especially. Analyze must stay fast; enrich is background chips.
3. **Blank basemaps** — OpenFreeMap vectors and Carto dark were unreliable. Use Carto raster light; Esri World Street Map if Carto errors.
4. **Coverage miss** — 0 tiles with a completed activity_id is not 0 °C. Phoenix 2026-08-17 is the textbook case.
5. **TCM property names** — tiles often have `average_temperature`, not `temperature`. Scoring and the map mapper copy that to `temperature`. Exceedance uses `value` as hours, not °C.
6. **3D heights** — OSM `height` / `building:levels` are sparse in Houston. Assumed 9 m is labeled. Do not claim FG shade.

---

## Judging and submission

Rubric ([Hackathon’26](https://www.fortyguard.com/hackathon26)):

| Criterion | Weight |
|---|---|
| Impact | 40 |
| Tech | 35 |
| Innovation | 15 |
| Communication | 10 |

Practical checklist:

- Add **Hackathon-FG** as a GitHub collaborator on the submission repo.
- **Live demo** (no login). Cache EaDo + Museum + Phoenix 2024-07-15 so judging is not a live credit lottery.
- **~3 min video.**
- **~500 word summary.**
- Keep FortyGuard **central** (activity_ids on the confidence strip). Overlay is the innovation, honestly labeled.

Pitch angle: hours above threshold on a real district, greener control tract the same day, slider that does **not** pretend to be FG.

---

## Links

- API docs: https://docs-api.fortyguard.com
- Create heatmap: https://docs-api.fortyguard.com/docs/create-heatmap
- Limitations / billing: https://docs-api.fortyguard.com/docs/limitations
- Dashboard (keys, usage): FortyGuard dashboard (team login)
- Hackathon: https://www.fortyguard.com/hackathon26
- Slack: **fortyguardhackthon26** (spelling as on the invite)
- Team: **FG-141 · HumanSlop**

---

## Research files (read in this order)

| File | Role |
|---|---|
| `RESEARCH-3D-URBAN.md` | **Current product lock** — Track 1 HeatCast, 2D scorecard + OSM 3D, no walking routes |
| `RESEARCH-SIMULATOR.md` | API + scenario formula lock (ΔT band, rain, endpoints) |
| `RESEARCH-PIVOT.md` | **Superseded hero** (HeatHall / Track 3). Keep FG calling rules and date discipline only |

---

## What’s next (before 30 Aug)

1. **Confirm visible choropleth** on Museum District and EaDo (this fill fix). If still blank, inspect DevTools: `heat-tiles` source feature count vs legend.
2. **LLM key hook** — `LLM_API_KEY` / `OPENAI_API_KEY` in `api/.env` so the planner brief is not always the template. Cite-or-silence only.
3. **3D shadows optional** — suncalc + extruded massing on a **known-height pad**. Do not claim sidewalk shade or FG-measured shade.
4. **Cache copy for judging** — freeze `api/cache` for EaDo, Museum, Phoenix `2024-07-15` TCM + exceedance so the live demo does not re-bill or miss coverage.
5. Video + 500-word writeup + add Hackathon-FG collaborator.

Do not expand into India, routing, or a second product.
