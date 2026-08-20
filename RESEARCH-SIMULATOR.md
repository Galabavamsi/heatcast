# HeatCast simulator research — urban planner analysis

**Team:** HumanSlop · FG-141  
**Hackathon:** FortyGuard Hackathon’26 · deadline 30 Aug 2026  
**Product:** HeatCast — district heatmap + estimated tree-cooling overlay (not a FortyGuard what-if)  
**Track:** Resilient Cities / urban planning. FortyGuard stays the measurement. Scenario cooling is a **labeled model**.

This brief is the API + formula lock for implementation. It does **not** claim sidewalk CFD, a new FortyGuard heatmap after “add trees,” or hydro modeling.

---

## 0. Honesty lock (do not violate in UI or memo)

| Claim | Truth |
|---|---|
| User adds trees / +10% canopy | FortyGuard does **not** return a new heatmap. There is no official what-if endpoint. |
| Scenario ΔT / hours saved | **Estimated overlay** from published canopy–air-temperature slopes + current FG tiles. Labeled *model, not FG measurement*. |
| FG tiles | 60 / 80 / 100 m, 2 m air, **US-only**. Demo uses **100 m**. |
| Phoenix | `2026-08-17` can complete with **0 tiles** (still billed). Use **`2024-07-15`**. Houston EaDo has contrast. |
| `env_params.heat_index_celsius` | Humidity-sensitivity at a fixed anchor — **not** duration. Duration = heatmap `exceedance` only. |
| Rain chip | Daily / hourly precip for **context** (evaporative cooling that day). Not a drainage or flood model. |
| Credits | Failed FG tasks are free. Empty **successful** heatmaps still cost. Cache `AOI + datetime + analytic_type`. |
| Secrets | `FORTYGUARD_API_KEY` and any LLM key stay in `api/.env`. Never in the Next.js bundle. |

---

## 1. Chosen stack (what HeatCast actually calls)

| Need | Chosen | Auth | Why this one |
|---|---|---|---|
| 2 m air + hours above | **FortyGuard** `tcm` + `exceedance` | Server key | The product. Area-unweighted 100 m tiles. |
| Why hot (cover) | **FortyGuard satellite** `tree` / `plant` vs impervious classes | Server key | Same centroid as hotspot; no extra land-cover account. |
| Hot-hour physiology | **FortyGuard `env_params`**: wet-bulb, apparent temp, `precipitation_mm`, RH | Server key | Point / coarse. Apparent + wet-bulb at **hot hour** only. |
| Rain for that date | **Open-Meteo** archive `precipitation_sum` + hourly `precipitation` at AOI centroid | **None** | Free, US-complete, historic `2024-07-15` works. FG precip is a second chip if present. |
| Buildings / 3D | **OSM Overpass** footprints (already in repo) → MapLibre `fill-extrusion` | None | Site massing. Heights sparse; default 9 m, labeled. |
| Scenario cooling | **Literature overlay** (this file) | n/a | Slider +10 / +20 % canopy. |
| Planner brief | **LLM if `LLM_API_KEY` / `OPENAI_API_KEY` else template** | Optional server key | Cite-only over scorecard JSON. |
| Flood (optional chip) | **FEMA NFHL** layer 28 point query | None | Houston context. Not a hydro model. Fail-open. |
| Ground elev. (optional) | **USGS 3DEP EPQS** one point | None | Construction pad context. Not a DEM mesh. |

**Basemap:** Carto raster (already working). Esri raster fallback. Not OpenFreeMap vectors. Optional Three.js later — **keep MapLibre extrusion working**.

---

## 2. Rain / precipitation

### 2.1 Open-Meteo (chosen)

- Docs: [Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), [Open-Meteo home](https://open-meteo.com/)
- Archive: `GET https://archive-api.open-meteo.com/v1/archive`
- Query: `latitude`, `longitude` (AOI centroid), `start_date=end_date`, `hourly=precipitation`, `daily=precipitation_sum,precipitation_hours,rain_sum`, `timezone=<city tz>`
- License: CC BY 4.0; non-commercial free tier ~10k calls/day; **no key**
- Grain: reanalysis grid (~9–25 km depending on era/model) — **coarser than FG 100 m**. Say so on the chip.
- Lag: ERA5-style archive lags several days. If archive is empty, fall back to `https://api.open-meteo.com/v1/forecast` with the same `start_date`/`end_date` (works for recent nowcast-ish windows).
- Use: “This date had X mm precip (Open-Meteo). Evaporative cooling context, not a hydrology model.”

### 2.2 FortyGuard `env_params.precipitation_mm`

- Valid analysis name on the client (`precipitation_mm`).
- Same coarse point as wet-bulb. Show if the array/scalar is present; do not treat it as radar nowcast.
- Prefer Open-Meteo for the **date total**; FG precip is a corroborating hotspot number.

### 2.3 NOAA / NWS — evaluated, not primary

| API | Auth | Fit | Verdict |
|---|---|---|---|
| [api.weather.gov](https://www.weather.gov/documentation/services-web-api) | No key; **User-Agent required** | Forecasts, alerts, recent observations | Good for *today*, weak for a stored `2024-07-15` demo date |
| [NCEI CDO v2](https://www.ncei.noaa.gov/cdo-web/webservices/v2) | **Free token** | Station daily precip | Extra signup; station ≠ AOI centroid |
| NCEI Access Data Service | Often no token | Bulk station CSV | More plumbing than Open-Meteo JSON |

**Not in v1:** NWS grid nowcast, MRMS radar tiles, hydrological routing.

---

## 3. Trees / canopy

| Source | Auth | What you get | Verdict |
|---|---|---|---|
| **FG satellite** classes `tree`, `plant` (and grass/vegetation) | Premium key | Percent mix at hotspot centroid, ~80–100 m | **Chosen current canopy** |
| OSM `natural=tree` / `landuse=forest` via Overpass | None | Points / polygons, incomplete in Houston | Optional density later; not the slider baseline |
| [NLCD / USFS tree canopy cover](https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer) | None (ImageServer) | 30 m % canopy rasters 1985–2023+ | Feasible identify/identify; extra GIS; skip for 11-day v1 |
| i-Tree Eco / Landscape | Desktop / licensed tools | Species-level ecosystem services | **Not a simple REST API** — do not pretend |

Slider meaning: **additional** district canopy percentage points (`+10`, `+20`), capped so current + added ≤ 80% (urban ceiling). Not “plant N trees.”

---

## 4. Cooling estimates (scenario formula)

### 4.1 Literature (air temperature, not LST)

Satellite land-surface temperature overstates human-relevant cooling. HeatCast uses **2 m air** slopes and stays **conservative**.

| Source | Metric | Slope (approx.) | Notes |
|---|---|---|---|
| Ziter et al. / Tacoma sidewalks, [Scientific Reports (2024)](https://www.nature.com/articles/s41598-024-51921-y) | Hourly **air** T vs % canopy within 10 m | **~0.01 °C per 1%** → **0.10 °C per 10%** | Linear; 0→100% ≈ 1.0 °C |
| Middel et al., Phoenix ENVI-met, [Urban Forestry & Urban Greening (2015)](https://doi.org/10.1016/j.ufug.2014.09.010) | Neighbourhood afternoon **air** T | **0.14 °C per 1%** canopy | Microclimate **model**, 0–30% cover; too aggressive to copy as a 100 m UHI overlay |
| Trees vs short veg, 216 cities, [ERL / IOP (2025)](https://beta.iopscience.iop.org/article/10.1088/2515-7620/ae0f83) | UTCI, not dry-bulb | ~0.042 K per 1% tree cover (huge SD) | Comfort index; arid cities can be near zero / negative |
| Madison canopy threshold summary, [NCEL](http://ncelenviro.org/articles/first-in-science-city-trees-can-reduce-urban-heat-island-effect/) | In-situ air T | Strong cooling near **~40%** canopy | Threshold story — do not linearize 4–5 °C onto a +10% slider |

**Default HeatCast band (locked):** **0.10–0.20 °C per +10 percentage points of canopy**, central **0.15 °C / 10%**. This sits on the observational air-temp studies and **rejects** the Phoenix ENVI-met 1.4 °C / 10% as a district overlay.

### 4.2 Locked formulas

Let \(c\) = additional canopy percentage points after cap (0–20 typical; never claim > remaining room to 80% total).

\[
\Delta T_{\mathrm{low}} = \min(2.0,\ 0.010\,c),\quad
\Delta T = \min(2.0,\ 0.015\,c),\quad
\Delta T_{\mathrm{high}} = \min(2.0,\ 0.020\,c)
\]

Cap **2.0 °C** so a wild slider cannot imply CFD-scale shade.

**Hours-above reduction** (no extra FG hourly film):

Let \(H\) = district mean exceedance hours, \(T\) = TCM mean °C, \(\theta\) = threshold.

\[
H_{\mathrm{saved}} = H \cdot \min\left(1,\ \frac{\Delta T}{\max(1,\ T-\theta+2)}\right)
\]

Same with \(\Delta T_{\mathrm{low/high}}\) for a range. If \(T\) is missing, use \(H_{\mathrm{saved}}=\min(H,\ 2.5\,\Delta T)\).

**Why this hours model:** FG exceedance is already a duration field. We do **not** re-run heatmaps. Cooling a district 0.3 °C when mean is 5 °C over threshold should save a **small** fraction of hours — honest. Overlay map: `estimated_c = measured_c − ΔT` on existing GeoJSON.

**UI copy (required):**

> Estimated canopy cooling — literature overlay, **not** a FortyGuard measurement. FortyGuard has no add-trees heatmap.

---

## 5. DEM / buildings

| Source | Feasible in 11 days? | Use |
|---|---|---|
| **OSM Overpass** `building=*` + `height` / `building:levels×3.5` else 9 m | **Yes — already shipped** | MapLibre fill-extrusion. Labeled assumed heights. |
| [USGS 3DEP EPQS](https://apps.nationalmap.gov/epqs/) `https://epqs.nationalmap.gov/v1/json?x=&y=&units=Meters` | Yes, one point, no key | Optional centroid elevation. RMSE ~0.53 m interpolated ([USGS FAQ](https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map)). Not a mesh. |
| 3DEP WCS / 1 m lidar download | No | Too heavy for live AOI. |

Do not imply OSM boxes + sun = FortyGuard shade.

---

## 6. Flood (optional)

[FEMA NFHL ArcGIS REST](https://hazards.fema.gov/femaportal/resources/flood_map_svc.htm) `public/NFHL/MapServer` layer **28** (Flood Hazard Zones), point-in-polygon, `FLD_ZONE`, `ZONE_SUBTY`, no key.

Houston EaDo can sit in SFHA. Chip: zone name + “floodplain context, not a rainfall-runoff model.” Fail-open if the service times out.

---

## 7. LLM memo

- If `LLM_API_KEY` or `OPENAI_API_KEY` is set on the API process, POST chat completions (`LLM_BASE_URL` default `https://api.openai.com/v1`, `LLM_MODEL` default `gpt-4o-mini`).
- Input: scorecard JSON only (hours, TCM, satellite buckets, rain mm, scenario ΔT range, `activity_id`s).
- Rule: **cite-or-silence**. No invented CFD, dollar OpEx, or “FG says trees cool this tile by X.”
- Else: deterministic template paragraph with the same numbers.

---

## 8. Explicitly out of v1

- Precomputing 12 hourly FG TCM frames unless already cached (hour dropdown may **re-hit cache** for one timestamp)
- OSRM / walking / cool-route
- OpenFreeMap vector basemap as a dependency
- i-Tree, NLCD raster pipeline, GRIDMET, OpenET
- Treating rain as flood depth or tree irrigation demand

---

## 9. Demo defaults

| District | Date | Why |
|---|---|---|
| Houston EaDo | 2024-07-15 15:00 | Contrast, construction / outdoor hours, 35 °C threshold |
| Houston Museum District | same day | Greener control |
| Phoenix Downtown | **2024-07-15 only** | Proof of second city; never sell `2026-08-17` as 0 °C |

---

## Sources

- [Open-Meteo](https://open-meteo.com/) (CC BY 4.0, no key for non-commercial)
- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api)
- [NWS API (api.weather.gov)](https://www.weather.gov/documentation/services-web-api)
- [NCEI Climate Data Online web services v2](https://www.ncei.noaa.gov/cdo-web/webservices/v2)
- [Street trees and sidewalk air temperature — Scientific Reports](https://www.nature.com/articles/s41598-024-51921-y)
- [Middel et al. Phoenix trees + cool roofs — Urban Forestry & Urban Greening](https://doi.org/10.1016/j.ufug.2014.09.010)
- [Cooling efficiency of trees vs short vegetation — ERL/IOP](https://beta.iopscience.iop.org/article/10.1088/2515-7620/ae0f83)
- [NCEL summary of Madison canopy threshold work](http://ncelenviro.org/articles/first-in-science-city-trees-can-reduce-urban-heat-island-effect/)
- [USGS National Map Elevation Point Query Service](https://apps.nationalmap.gov/epqs/)
- [USGS — EPQS accuracy](https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map)
- [FEMA NFHL GIS web services](https://hazards.fema.gov/femaportal/resources/flood_map_svc.htm)
- [USFS/NLCD tree canopy cover ImageServer](https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer)
- FortyGuard env / heatmap constraints: local `temperature-api-quickstart` + prior HeatCast research (`RESEARCH-3D-URBAN.md`, `RESEARCH-PIVOT.md`)
