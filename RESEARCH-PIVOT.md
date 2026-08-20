# HeatLens pivot brief — FortyGuard Hackathon’26

**Team:** HumanSlop · FG-141  
**Deadline:** 30 Aug 2026 (~11 days from 19 Aug)  
**Decision:** ship **one** industrial / data-hall siting screener. Do not build farm-pond, recharge-well, or multi-use dossier as the hero.

---

## 1. Recommendation (read this first)

**Hero product: HeatHall — parcel-scale data-center / industrial intake siting.**

A US site-acquisition or energy engineer draws a closed parcel (or loads a Houston preset). The backend scores that AOI for **air-cooled / evaporative-cooled hall suitability** using FortyGuard 2 m air temperature (duration, not peak), land cover, street-level intake shade, wet-bulb, then two hard external gates: **FEMA flood zone** and **nearby USGS water**. An LLM writes a one-page memo that may only cite those layers.

**Why this wins on the rubric**

| Criterion (weight) | Why HeatHall scores |
|---|---|
| Impact 40 | Real buyer: DC / industrial site teams already on [FortyGuard’s data-center page](https://www.fortyguard.com/data-centers-nuclear-energy-plants). Cooling load, uptime, flood kill-switch. |
| Tech 35 | All five Premium endpoints + 2–3 free geo APIs + AOI-weighted exceedance (the official parcel method). Key stays on the FastAPI side. |
| Innovation 15 | Not a cool-route, not a bus-stop clone, not a Track-6 “agent wraps the API” toy. Duration-at-parcel + flood/water gates. |
| Comm 10 | One number, one map, one memo. Live, no login. |

**Track:** 3 — Industrial & Enterprise. Also readable as Track 2 (Future Buildings & Energy). Do **not** lead as Track 6 Agentic AI — Slack is already crowded there; the LLM is a memo writer, not the product.

**Default demo:** Houston metro (live coverage, strong spatial contrast). **Second example:** Phoenix on `2024-07-15` only (not `2026-08-17`).

**One-number demo claim (form — compute live, do not hard-code):**

> On the same study week, the hotter Houston parcel accumulates **N hours above 35 °C** vs **M hours** on the cooler parcel a few km away — an **N/M×** intake-heat gap. A flood-zone AE hit is a hard fail regardless of temperature.

Lead with hours, not peak °C. Official parcel notebooks show daily-peak spread collapses to ~0.9 °C at parcel scale while exceedance still spans many hours ([quickstart README](../temperature-api-quickstart/README.md)).

---

## 2. Scorecard of the five directions

Scale 1–5. **Do not ship anything scoring <4 on FortyGuard centrality as the hero.**

| Direction | FG centrality | Uniqueness vs Slack / handbook | 11-day / 2 people | Measurable before/after | Free geo APIs | Verdict |
|---|---|---|---|---|---|---|
| 1. Urban shade / UHI interventions | **5** | **2** | **5** | **4** | **5** | Cut. Official parks + bus-stop notebooks already do this. Track 1 examples include Cool Route Planner. |
| 2. Farm microclimate | **3** | **4** | **3** | **3** | **3** | Cut for v1. OpenET needs an account; NASS is county-scale; GRIDMET is ~4 km; streetview is sparse on fields. FG 2 m air ≠ canopy or soil temp. |
| 3. Wells / lakes / ponds / recharge | **2** | **5** | **2** | **2** | **4** | Cut as hero. Air temp is a weak proxy for evaporation and almost irrelevant to aquifer siting (soils, lithology, head). High novelty, low FG centrality — judges will call it decorative. |
| 4. **Data-center / industrial siting** | **5** | **4** | **4** | **5** | **4** | **HERO.** 2 m air **is** intake air. Wet-bulb is cooling-tower physics. Flood is a real kill-switch in Houston. |
| 5. Multi-use site dossier | **4** | **5** | **3** | **3** | **4** | Stretch badge only. Four shallow scores + LLM guesses (“good recharge well”) lose Tech + Impact vs one defensible number. |

Honest compare of the three shortlisted heroes:

| | Data-hall screener | Farm pond / recharge | Multi-use dossier |
|---|---|---|---|
| Would a client pay? | Yes — DC developers already buy heat + flood diligence | Maybe (NRCS / ag lender), smaller ticket | Yes in theory (land brokers), messy scope |
| FG must-have? | Yes — weather-station / ERA5 cannot see 100 m intake contrast | Weak — OpenET + SSURGO do more of the work | Only if scoring is heat-led |
| 11-day risk | Medium (2–3 APIs) | High (OpenET + SDA SQL + rural coverage) | High (four scoring models) |
| Clone risk | Low | Low | Medium (parcel due-diligence notebook) |

**Do not build the hybrid as the hero.** If a day remains after the DC scorecard is cached, add a single “not a pond / not housing” chip driven by the *same* flood + satellite water/impervious numbers — no extra APIs.

---

## 3. User and job-to-be-done

**User:** Site-acquisition analyst or energy engineer at a data-center / light-industrial developer (Houston first).

**Job:** “Before we option this parcel, is outdoor intake air, flood, and cooling-water proximity a pass, a price, or a kill?”

**Not the job:** walk routing, bus-stop ranking, farm irrigation calendar, inventing well locations, chatting with an agent.

---

## 4. Exact FortyGuard calls

Keep FortyGuard **central**. Every score row must come from a real `activity_id`.

### Heatmaps (`POST /v1/heatmap`) — AOI polygon, `[lon,lat]`, closed ring, ≤45 mi² (stay under the 50 mi² Premium cap)

| Call | `analytic_type` | Window | Why |
|---|---|---|---|
| Snapshot | `tcm` | `filter_type=1`, 15:00 local (Houston 15:00, Phoenix 15:00, Miami 14:00) | Map tiles °C. Do **not** rank parcels by this at small AOI. |
| Duration | `exceedance` | `filter_type=4` (study week, e.g. 2024-07-15 → 2024-07-21) or `filter_type=3` if week is too slow | **Lead metric.** Hours above threshold. Houston 35 °C, Phoenix 38 °C, Miami 33 °C. `direction=above`. |
| Streak | `persistence` | same window + threshold | Longest continuous run — worker / derate story. |

Granularity: **100 m** for screen (credits + speed); 60 m only on the winning preset if time.

Join method: **area-weighted mean of overlapping tiles** (copy parcel notebooks). Do not use centroid-in-tile.

### `env_params` — centroid only, once

Pass `temperature` = area-weighted TCM peak (°C). Request:

- `wet_bulb_temperature_celsius` — cooling-tower / evaporative limit  
- `apparent_temperature_celsius` — use **hot-hour** only  
- `relative_humidity_percent`  
- `precipitation_mm`  
- `solar_irradiance` (GHI) — solar load on roof / dry coolers  

**Never** count hours from `heat_index_celsius`. It is a humidity-sensitivity curve at a fixed anchor, not a diurnal forecast; it peaks overnight. Duration comes only from heatmap exceedance. `env_params` is coarser than parcels — two sites ~1 km apart can be identical; say so on the card.

### Satellite (`POST /v1/satellite`, Premium)

Centroid, `filter_type=3`, granularity 80. Bucket classes (notebook vocabulary):

| Bucket | Keywords | Use |
|---|---|---|
| Impervious | `building`, `road`, `route`, `sidewalk`, `pavement` | Heat + stormwater + hall pad |
| Canopy | `tree` | Shade / cooler intake |
| Vegetation | `tree`, `plant`, `grass`, `vegetation` | Soften / not a hall if too high? (context only) |
| Water | `water` (if present) | Cooling-water / pond adjacency |

### Street view (`POST /v1/streetview`, Premium)

Centroid, `vertical_angle=10`, `horizontal_angle=90`, `back_view=false`. Bucket `sky` (open intake sun), `tree` (ground shade), `building`, `road`. Rural / private parcels may miss — treat empty as “no panorama,” not 0% shade.

### Heat intelligence (`POST /v1/heat_intelligence`, Premium)

Once on the **lead** parcel. Analyses: `geographic`, `environmental`, `urban`. Stream PDF to backend `outputs/`; expose `/v1/pdf/{id}` like today. Do not parse the PDF as a score.

Cache key: **AOI fingerprint + datetime + analytic_type + threshold**. Empty completed heatmaps still cost credits — never retry Phoenix `2026-08-17`. Failed tasks are free; do not cache failures.

---

## 5. External geo APIs — pick exactly three

All US, no paid key. EIA is a **free** email key.

| # | API | Auth | What to pull | How it scores |
|---|---|---|---|---|
| 1 | **FEMA NFHL** ArcGIS REST [`public/NFHL/MapServer`](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer) | None | Flood Hazard Zones intersecting the polygon (`FLD_ZONE`, `ZONE_SUBTY`) | **Hard fail** if AE / VE / A / floodway. X / area not mapped = pass with note. |
| 2 | **USGS Water Data** [`monitoring-locations`](https://api.waterdata.usgs.gov/) | None | Sites in AOI bbox; type stream / lake / groundwater | Distance to nearest surface-water and groundwater site (m). Context for cooling water — **not** “you can withdraw here.” |
| 3 | **EIA Open Data v2** [`electricity/retail-sales`](https://www.eia.gov/opendata/) industrial price | Free key ([register](https://www.eia.gov/opendata/register.php)) | Latest TX (or AZ/FL) industrial `price` ¢/kWh | Cost context only. State-scale — label as such. Keep key on the server. |

**Do not integrate in 11 days**

| API | Why cut |
|---|---|
| OpenET | Free but **account + quota**; farm-only; timeouts under load ([etdata.org/api](https://etdata.org/api/)) |
| WRI Aqueduct | Atlas / shapefile download, not a cheap point API |
| USDA SSURGO / SDA `post.rest` | No key, but SQL + spatial join is a 2-day sink; save for pond stretch |
| NASS Quick Stats | Free key, **county** grain — useless at parcel |
| GRIDMET / METDATA | ~4 km — coarser than FG; would make FG look decorative |
| HIFLD substations | Access / hosting unstable; do not bet the demo |
| NationalFloodData.com | Paid key — use official NFHL instead |
| OpenFEMA disasters | Free, no key, but declarations ≠ site flood zone |

---

## 6. LLM / agent rules

The LLM is **not** the product. It writes a memo after scores exist.

**May**

- Restate numbers already on the scorecard, with units and `activity_id` / FEMA zone / USGS site id.
- Compare the two Houston presets.
- Quote ASHRAE-style *language* only as “compare against published 27 °C recommended envelope” if the number on screen is FG dry-bulb or wet-bulb.
- Say “unknown” when streetview is empty or `env_params` arrays match another parcel.

**Must not**

- Invent wells, injection sites, substations, transmission capacity, or PPA prices.
- Turn `heat_index_celsius` into “hours of danger.”
- Invent dollar cooling OpEx unless a labeled formula is shown (`hours_above_35 × placeholder kW/MW`). Prefer hours, not dollars.
- Treat a completed 0-tile heatmap as 0 °C.
- Run as a free-form agent that calls FortyGuard in a loop (credits + Track-6 clone).

Cite-or-silence: every factual sentence tags a layer. No tag → delete the sentence.

---

## 7. Screens (live, no login)

1. **Map** — MapLibre, Houston default. Draw closed polygon **or** click preset A / preset B. Area readout; block >45 mi².
2. **Layers** — TCM tiles (°C), exceedance tiles (hours), FEMA zone outline, USGS site dots. Toggle. Coverage-miss banner if `n_cells=0`.
3. **Scorecard** — Pass / price / kill. Rows: exceedance hours, persistence hours, wet-bulb at hot hour, impervious %, sky %, FEMA zone, nearest USGS water (m), EIA industrial ¢/kWh (state).
4. **Memo** — LLM paragraph + download Heat Intelligence PDF.

No origin/destination pins. No route polylines. No login.

**Presets to cache before judging**

| ID | Place | Why |
|---|---|---|
| `houston-ship` | East End / Ship Channel industrial (keep well under 5 mi²) | Hot, paved, flood-relevant |
| `houston-west` | West Houston / Energy Corridor or Memorial-adjacent industrial | Cooler, more canopy, same metro |
| `phoenix-2024-07-15` | Small industrial AOI, historic date only | Second-city proof; never `2026-08-17` |

---

## 8. What to rip out of current HeatLens

Keep the repo. Change the job.

| Rip | Keep / retarget |
|---|---|
| `api/app/osrm.py` and public OSRM | — |
| A→B click state in `web/src/app/page.tsx` | Polygon draw + presets |
| `score_route` / fastest-vs-cooler labels | Area-weighted parcel score |
| Corridor buffer `lines_to_corridor_polygon` | User polygon + `polygon_area_mi2` |
| Header “Fastest vs cooler walk” | “Intake heat vs flood — Houston” |
| Walk sample-line 40 m | Tile overlap weights (parcel method) |

**Keep:** FastAPI + Next + MapLibre; `fortyguard` client; disk cache keyed by AOI+datetime; coverage-miss handling; secret stripping; `env_snapshot` wet-bulb/apparent at hot hour; satellite/streetview `class_percents`; heat-intelligence PDF route; Houston / Phoenix / Miami city table (Phoenix `default_date=2024-07-15`).

Bind HTTP to `0.0.0.0:$PORT` if deploying to Render. Filesystem is ephemeral — treat `api/cache/` as local/demo only; pre-warm presets before the live demo.

---

## 9. Architecture (no new codebase here)

```
Browser (Next/MapLibre)  --no API key-->  FastAPI
                                            ├─ FG heatmap tcm / exceedance / persistence (cached)
                                            ├─ FG satellite + streetview + env_params + heat_intelligence
                                            ├─ FEMA NFHL query
                                            ├─ USGS monitoring-locations bbox
                                            ├─ EIA retail-sales industrial (server key)
                                            └─ LLM memo (server key) ← scorecard JSON only
```

Credits: Premium 2M. Still cache everything. Do not re-fire empty Phoenix. One heatmap per preset per date is enough for the live talk.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Phoenix empty tiles (`2026-08-17` completed with 0 cells, still billed) | Default Phoenix to `2024-07-15`. Banner: coverage miss ≠ 0 °C. |
| `env_params` coarseness / bogus heat-index diurnal | Wet-bulb + apparent at hot hour only; duration from exceedance. |
| 50 mi² cap | Hard-stop at 45 mi²; presets <5 mi². |
| Parcel TCM is flat | Lead with exceedance hours (official finding). |
| Streetview miss on industrial lots | “No panorama” — do not zero-fill. |
| EIA is state-scale | Label “Texas industrial retail, not this feeder.” |
| USGS site ≠ withdrawal right | “Nearest monitored water, not a permit.” |
| Slack Track 6 clones | LLM is last, not first. |
| Official parcel notebook look-alike | Different buyer (DC), flood+water+EIA gates, live AOI draw, no San Jose CSV. |

---

## 11. Cut-list (say no)

- Walking / cool-route / OSRM  
- Bus-stop or parks audit (handbook notebooks)  
- Farm planting calendar, NDVI, NASS yields  
- OpenET, Aqueduct, GRIDMET, HIFLD  
- Recharge / injection well siting as a scored use  
- Free-form agent that loops FortyGuard  
- Dollar PUE model presented as measurement  
- Frontend API keys  
- Multi-city live 2026 dates besides Houston (and Miami if needed)

---

## 12. Geo-API research notes (for implementers)

**FortyGuard constraints (local + docs):** US-only; heatmap ≤50 mi² Premium; tiles °C; `analytic_type` = `tcm` / `time_of_measure` / `exceedance` / `persistence`; failed tasks free; completed empties cost credits; `heat_index_celsius` is not a forecast ([limitations](../.firecrawl/docs-pages/limitations.md), [create heatmap](../.firecrawl/docs-pages/create-heatmap.md), [env_params](../.firecrawl/docs-pages/environmental-parameters.md)).

**Hackathon tracks:** Resilient Cities; Future Buildings & Energy; Industrial & Enterprise; Government & Environment; Model Designing; Agentic AI; Data Analysis ([hackathon26](https://www.fortyguard.com/hackathon26)). Track 1 build examples include Cool Route Planner — avoid.

**FortyGuard already sells DC cooling intelligence** at 2 m ([data-centers page](https://www.fortyguard.com/data-centers-nuclear-energy-plants)).

**Ag APIs (evaluated, not in v1):** OpenET monthly/daily ET, free with account + quotas ([OpenET API](https://etdata.org/api/)); SSURGO via SDA `post.rest` no key ([SDA help](https://sdmdataaccess.nrcs.usda.gov/webservicehelp.aspx)); NASS Quick Stats free key, county grain ([NASS API](https://quickstats.nass.usda.gov/api)).

**Water APIs:** USGS modern Water Data APIs — continuous, daily, monitoring-locations, no paid key ([api.waterdata.usgs.gov](https://api.waterdata.usgs.gov/)); FEMA NFHL REST/WFS no key ([NFHL services](https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS)); OpenFEMA free/no key but not site flood zones ([OpenFEMA](https://www.fema.gov/about/openfema/api)); WRI Aqueduct is an atlas/download, not a 11-day point API ([Aqueduct](https://www.wri.org/applications/aqueduct/water-risk-atlas/)).

**Grid:** EIA APIv2 requires a free key; `electricity/retail-sales` has monthly industrial price by state ([EIA docs](https://www.eia.gov/opendata/documentation.php)).

---

## Sources

- [FortyGuard Hackathon’26](https://www.fortyguard.com/hackathon26) (Aug 2026)
- [FortyGuard — Data Centers & Nuclear Energy Plants](https://www.fortyguard.com/data-centers-nuclear-energy-plants)
- [FortyGuard Temperature API quickstart README](../temperature-api-quickstart/README.md)
- [Create Heatmap docs](https://docs.api.fortyguard.com) (local scrape: `.firecrawl/docs-pages/create-heatmap.md`)
- [Environmental Parameters docs](../.firecrawl/docs-pages/environmental-parameters.md)
- [Satellite segmentation docs](../.firecrawl/docs-pages/satellite-view-segmentation.md)
- [Known Limitations](../.firecrawl/docs-pages/limitations.md)
- [EIA Open Data](https://www.eia.gov/opendata/)
- [EIA API documentation](https://www.eia.gov/opendata/documentation.php)
- [USGS Water Data APIs](https://api.waterdata.usgs.gov/)
- [FEMA NFHL GIS web services](https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS)
- [OpenFEMA API](https://www.fema.gov/about/openfema/api)
- [USDA Soil Data Access web service help](https://sdmdataaccess.nrcs.usda.gov/webservicehelp.aspx)
- [OpenET API](https://etdata.org/api/)
- [OpenET API docs](https://openet.gitbook.io/docs)
- [WRI Aqueduct Water Risk Atlas](https://www.wri.org/applications/aqueduct/water-risk-atlas/)
- [NASS Quick Stats API](https://quickstats.nass.usda.gov/api)
