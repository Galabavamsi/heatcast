# HeatCast — 3D urban / construction scope (decision-ready)

**Team:** HumanSlop · FG-141  
**Track (user override):** 1 — Resilient Cities & Infrastructure (urban planning). Not HeatHall / Track 3.  
**Deadline:** 30 Aug 2026 (~10 days from 20 Aug)  
**Repo:** keep FastAPI + Next.js HeatLens. Do **not** rewrite the app in this document.  
**Decision:** ship **one** neighborhood-scale 3D heat + shade tool. FortyGuard stays central. Walking routes die.

This brief overrides [RESEARCH-PIVOT.md](./RESEARCH-PIVOT.md) on product and track. Keep its FortyGuard calling rules, Houston/Phoenix date discipline, cache, and coverage-miss handling.

---

## 0. Read this first

| Lock | Choice |
|---|---|
| Hero name | **HeatCast** |
| Job | Urban planner / construction PM: *hours above threshold + hours in shade on this AOI* |
| 3D engine | **Keep Next + MapLibre 6 + Three.js custom layer** |
| Basemap | **Carto raster** (already working). Esri raster fallback. Do not depend on OpenFreeMap vectors. |
| 2D fallback | **Yes.** Same GeoJSON heat fill if WebGL custom layer fails. |
| Animation | **12 cached TCM hours** on one Houston AOI (~2 km²), `2024-07-15`, gran **100**. Not a 7-day hourly film. |
| Shadows | **suncalc + extruded massing**. Defensible on a construction pad / known-height boxes. Not sidewalk CFD. |
| FortyGuard | Heatmaps are the product. Buildings/sun are context. No FG 3D meshes exist. |

**One-number demo claim (compute live from cached tiles; do not hard-code):**

> On 15 Jul 2024, this Houston pad accumulates **N hours ≥ 35 °C** (FortyGuard exceedance) while sun-cast shade covers the slab only **M of the 10:00–16:00 work hours**. Adjacent cooler fabric is **K hours** above the same threshold.

Lead with **hours**, not peak °C, and never imply 100 m tiles resolved a sidewalk.

---

## 1. Hero product + one-sentence job

**HeatCast** — FortyGuard 2 m heat, on the massing, under the sun.

**Job (urban planner / construction PM):** Draw a Houston neighborhood or site AOI and see where heat *lasts*, where proposed (or existing) massing will *cast shade*, and which hours outdoor work / public space exceeds a threshold — on one interactive 3D map, live, no login.

Not the job: A→B walking, Cool Route, bus-stop ranking, city-scale digital twin, facade CFD, India, data-center flood screener (HeatHall).

**Why this still scores on the rubric**

| Criterion (weight) | Why HeatCast scores |
|---|---|
| Impact 40 | Real buyer: city heat-action / urban design, plus construction PM (OSHA-style outdoor work windows, crane/pad shade). Measurable: hours ≥ 35 °C vs shade hours on the same AOI. |
| Tech 35 | All Premium endpoints used with purpose. Area-weighted exceedance (official parcel method). OSM/Overture extrude + suncalc shadows. Cache + coverage-miss. Key stays on FastAPI. |
| Innovation 15 | Track 1 lists Digital Twin Simulation — we ship a **scoped** twin (one AOI, extruded boxes + FG tiles), not a Cool Route clone and not a photorealistic Google city. |
| Comm 10 | One 3D scene, one slider, one scorecard, one memo. Pitch already on. |

Track 1 official examples include Cool Route Planner, Public Asset Heat Audit, and Digital Twin Simulation ([Hackathon’26](https://www.fortyguard.com/hackathon26)). Use the twin *example*, not the route *example*.

Industry/cooling-intake is a **mode chip** on the same AOI (“outdoor work / intake air”), not a second product. That overlaps HeatHall physics (2 m air *is* intake air) without abandoning Track 1.

---

## 2. What 3D actually shows vs what would be fake

FortyGuard returns **2.5D GeoJSON tiles** (60/80/100 m polygons, °C or hours). It does **not** return building meshes, DEMs, tree canopies, or shadows ([Create Heatmap](https://docs-api.fortyguard.com/docs/create-heatmap), local scrape `../.firecrawl/docs-pages/create-heatmap.md`).

| Layer | Honest | Fake if you imply this |
|---|---|---|
| FG TCM fill on the ground (or extruded 1–3 m “heat slabs”) | 2 m air temperature per ~100 m cell | “This sidewalk is 3 °C cooler in the shade of that awning” |
| FG exceedance / persistence | Hours (or longest run) above threshold at tile scale | Hourly microclimate under a crane |
| Time slider over cached TCM frames | Same AOI, different `filter_type=1` timestamps | Continuous 24h physics simulation |
| Extruded footprints | OSM/Overture boxes; height from `height`, else `building:levels × 3.5 m`, else a labeled default | Photoreal Houston / LOD2 roofs / interiors |
| Sun-cast shadows | GPU shadow map from **those boxes** + suncalc sun vector | FG-measured shade; tree shade; glass reflectance |
| Shade-hours on a pad | Sample the **site polygon** in the shadow map at 15–30 min steps, 10:00–16:00 | “Hours this sidewalk is shaded” at 100 m FG grain |
| Street-view / satellite percents | Centroid class mix (sky / tree / building / impervious) | Pixel-perfect canopy for the whole AOI |
| `env_params` wet-bulb / GHI | Point (centroid), coarser than parcels | Per-tile wet-bulb |

**Scale, said out loud on the UI:** neighborhood **UHI and site heat-load**, not facade CFD. A 100 m tile is a small city block, not a curb.

**Construction is the defensible shadow story.** The PM knows the massing height (or we drop a preset 40 m box). Shade hours on *that pad* are geometry + astronomy. FortyGuard says when the pad is thermally hostile. Combined metric is credible. City-wide “every sidewalk’s shadow” is not — OSM heights in Houston are incomplete ([OSM height tags are sparse outside imports/landmarks](https://community.openstreetmap.org/t/building-heights/79205); Microsoft’s older TX height extract covered *downtown Houston*, not the whole metro ([OSM wiki](https://wiki.openstreetmap.org/wiki/Microsoft_Building_Footprint_Data))).

**Go / no-go for city-context shadows (day-1 spike, 2 hours):**

1. Overpass (or a frozen Overture clip) for the demo AOI.  
2. Share of footprint **area** with `height` or `building:levels`.  
3. **≥ 40%** → extrude real heights + default the rest as “context (assumed 9 m)” with a badge.  
4. **< 40%** → shadows **only** from user/preset massing + buildings that *do* have height. Context boxes stay unshaded or dashed.  
5. Overpass timeout → skip shadows, keep extrusion + heat. Still a 3D demo.

Do not color buildings with FG °C and call it a thermal facade. Color the **ground tiles**. Buildings stay massing (light concrete / heat-tinted only as a legend, not a measurement).

---

## 3. Technical stack (what ships in 10 days on Windows)

HeatLens already is Next 16 + `maplibre-gl@^6.4.1` + `react-map-gl` + Carto raster with Esri fallback (`web/src/components/HeatMap.tsx`). OpenFreeMap vectors went blank once; do not make them load-bearing.

### Recommendation: **Next + MapLibre + Three.js custom layer**

| Piece | Choice | Why |
|---|---|---|
| App shell | Keep FastAPI + Next | 10 days. Cache, FG client, coverage-miss already exist. |
| Map | MapLibre 6 + react-map-gl | Same version MapLibre documents for Three custom layers. |
| Basemap | Carto `light_all` raster → Esri World Street Map on error | Keyless, already coded. |
| Heat | MapLibre `fill` GeoJSON (today) **and/or** Three ground mesh | Fill already works; keep it as 2D fallback. |
| Buildings | Frozen GeoJSON for demo AOI; Overpass for live draw | No vector-tile glyph/source-layer drama. |
| Shadows / sun | Three.js `CustomLayerInterface` `renderingMode: '3d'` + `DirectionalLight` shadow map + [suncalc](https://github.com/mourner/suncalc) | Official MapLibre example: [Add a 3D model with shadow](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-with-shadow-using-threejs/). |
| Pitch / UX | `pitch: 50–65`, `maxPitch: 85`, time slider, layer toggles | “Wow” without a new engine. |

MapLibre 6.4.1 shares the GL context with Three (`WebGLRenderer({ canvas, context: gl })`, `autoClear: false`, `renderer.resetState()`). That is the documented path, not a research prototype.

### Compared and cut

| Option | Verdict | Reason |
|---|---|---|
| **Threebox** | Cut | Built for Mapbox GL / Azure Maps; sunlight/shadow helpers assume Mapbox fill-extrusion + token ([threebox](https://github.com/jscastro76/threebox/), [building shadows example](https://github.com/jscastro76/threebox/blob/master/examples/14-buildingshadow.html)). Extra MapLibre-6 risk. |
| **@watergis / maplibre-gl-three** | Cut as core | Aimed at **3D Tiles** via `3d-tiles-renderer` ([npm.io](https://npm.io/package/maplibre-gl-three)), not FG GeoJSON + box extrude + suncalc. Optional later if you drape a tileset. |
| **deck.gl MapboxOverlay** | Optional, not hero | Excellent GeoJSON extrude + MapLibre interleave ([deck.gl + MapLibre](https://github.com/visgl/deck.gl/blob/master/docs/developer-guide/base-maps/using-with-maplibre.md)). **Does not give you sun shadow maps.** Use only if MapLibre fill-on-pitch is too slow. Adds a second WebGL stack. |
| **CesiumJS + ion** | Cut | Full engine rewrite, ion token, Community plan is non-commercial / quota’d ([Cesium ion pricing](https://cesium.com/platform/cesium-ion/pricing/) — 15 GB stream, 1,000 Google photorealistic root tiles). OSM Buildings look great ([Cesium OSM Buildings](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/)) but draping FG polygons + defensible shadows in 10 days on Windows is a trap. Photoreal meshes also hide that FG is 100 m. |
| **Pure Three.js globe** | Cut | You rebuild pan/zoom, attribution, GeoJSON picking, fallback. Worse UX, same 10-day clock. |
| **Google Photorealistic 3D Tiles** | Cut | Needs Map Tiles API key + billing ([Google 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles)). ToS/attribution. Mesh is not extrude-to-height; shadow-on-photoreal is research. Judges may see Google, not FortyGuard. |

**Windows note:** stay on the stack that already runs (`next dev` + uvicorn). Avoid Cesium’s webpack/asset copy and ion tokens. Three as an npm module (`three` + `suncalc`) is enough.

**Building data (pick in this order):**

1. **Freeze** `web/public/data/houston-heatcast-buildings.geojson` for the demo AOI (Overture buildings clip preferred — US heights are richer than raw OSM; [Overture buildings](https://docs.overturemaps.org/guides/buildings/)). One evening with `overturemaps` CLI / DuckDB bbox. Commit the clip (not the planet).  
2. Runtime **Overpass** behind FastAPI for user-drawn polygons, cached by bbox. Timeout 25 s, degrade gracefully.  
3. Do not require OpenFreeMap `source-layer: building` — that path already failed once.

---

## 4. Historical animation — frame budget + cache

**Rule:** each timestamp is **one completed heatmap task**. Completed empties still cost credits; failures are free ([limitations](https://docs-api.fortyguard.com/docs/limitations)). Exact credits-per-call are unpublished (“complexity and data requirements”); plan in **task counts**, not dollars. Hackathon key: Premium **2M** credits. Treat animation as a **precompute**, never a live loop.

### Geometry

| AOI | Area | 100 m cells (order of mag.) | Premium cap |
|---|---|---|---|
| Demo neighborhood | **~2 km²** (~0.77 mi²) | ~200 | Fine |
| Upper bound | 5 km² (~1.93 mi²) | ~500 | Fine |
| Do not | 24h × 7d hourly on 5 km² | **168 heatmaps** | Credit + queue suicide |

Stay **≤ 2 km²** for the film. Live draw hard-stop **45 mi²** (Premium 50). Presets **< 2 km²**.

### Locked demo film (pre-warm into `api/cache/`)

| Frames | Spec | Tasks |
|---|---|---|
| **12 TCM** | Houston AOI, `2024-07-15`, `filter_type=1`, gran **100**, hours **07:00–18:00** local (`America/Chicago`) | 12 |
| **1 exceedance** | Same AOI, `2024-07-15` → `2024-07-21`, `filter_type=4` (fallback `3` if 4 errors), threshold **35 °C**, `direction=above` | 1 |
| **1 persistence** | Same window + threshold | 1 |
| **1 optional ToM** | `time_of_measure`, same day or week | 0–1 |
| Enrichment (once, centroid) | `env_params`, satellite 80 m `filter_type=3`, streetview, heat_intelligence PDF | 4 |

**Hero pack ≈ 18–20 billed tasks**, then **zero** during the talk.

### What not to animate

| Idea | Why cut |
|---|---|
| 24 hourly frames | Diminishing wow; 12 already shows the pulse (cool morning → peak 15:00 → evening). |
| 7-day × 24h | 168 heatmaps. |
| 7-day daily 15:00 (7 TCM) | Allowed as a **second** preset if credits remain; not the hero slider. |
| Live scrub that hits FG | Queue latency + credit burn + Phoenix-empty risk. |
| 60 m film | ~2.8× tiles vs 100 m; save 60 m for one still on the winning pad. |

### Cache strategy (already in `api/app/cache.py` / `fg.py`)

Key = `heatmap` + AOI fingerprint (coords rounded 5 dp) + date + time + `filter_type` + gran + `analytic_type` + threshold + direction.

- Cache **completed** payloads only.  
- **Never** cache failures.  
- **Never** retry Phoenix `2026-08-17` (0 tiles, still billed). Phoenix only `2024-07-15`.  
- Commit or USB-copy `api/cache/*.json` before judging. Render’s disk is **ephemeral** — do not rely on first-judge-hit to fill cache.  
- UI: slider reads an array of cached FeatureCollections; interpolating colors between hours is **visual only** — say “blended frames,” not new FG data.  
- Live polygon: **1× TCM (15:00) + 1× exceedance**. No film. Banner: “Animation is precomputed for the Houston demo AOI.”

### Slider UX

- Default date **2024-07-15 15:00** (hottest talk track).  
- Play 07:00→18:00 at ~400 ms/frame.  
- Dual-bind sun: when the hour changes, suncalc updates the Three light **and** the TCM fill. Heat and shadow stay the same clock. That is the wow; it is not claiming FG modeled the shadow.

---

## 5. Shadow approach (defensible)

**Pipeline**

1. Buildings: frozen GeoJSON + optional Overpass.  
2. Height: `height` (m) else `building:levels × 3.5` else **9 m context** with `height_source` on the feature.  
3. Construction preset: one **massing box** (e.g. 80 × 40 × 40 m) the user can move/resize (or a locked EaDo pad). This height is **known**, not guessed.  
4. Sun: `SunCalc.getPosition(date, lat, lon)` → altitude / azimuth. Confirm units on the installed package (classic mourner API is **radians**, azimuth from **south**; newer wrappers may use degrees from north). Convert to a Three `DirectionalLight` in ENU (east, up, north), intensity 0 below horizon.  
5. Renderer: `shadowMap.enabled`, `PCFSoftShadowMap`, ortho frustum fitted to the **AOI** (~2 km), map size 2048² (4096² only if GPU is fine). Ground `ShadowMaterial` receives; building meshes cast. Follow the [MapLibre Three shadow example](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-with-shadow-using-threejs/).  
6. **Shade hours (scorecard):** for 10:00–16:00 on the study day, every 20 min, sample N points in the **site polygon** (not the whole neighborhood). Fraction in shadow × 6 h = shade hours. Independent of FG.  
7. Badge: “Shade from extruded massing + sun position. Not a FortyGuard product. Trees omitted. OSM/Overture heights incomplete.”

**Skip shadows entirely if:** WebGL1-only, Overpass empty, or day-1 height coverage is hopeless **and** the massing gizmo slips. Then: pitched fill-extrusion + heat still looks 3D. MapLibre native extrusion has lighting, not a sun shadow map ([display buildings in 3D](https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/)).

**Do not:** shadow-map a photoreal Google mesh and call it OSHA shade; use FG 100 m to “validate” a 5 m shadow; include trees unless a later stretch uses satellite `tree` % as a *scalar* (not a canopy mesh).

---

## 6. FortyGuard calls for the hero flow

Keep FortyGuard **central**. Every score row cites an `activity_id`. Polygon: closed `[lon,lat]` ring, US only.

### Heatmaps `POST /v1/heatmap`

| Call | `analytic_type` | Window | Role |
|---|---|---|---|
| Film | `tcm` | `filter_type=1`, each demo hour | Slider °C |
| Talk still | `tcm` | 15:00 local | Default view |
| Lead metric | `exceedance` | Week `filter_type=4` (or day `3`) | Hours ≥ 35 °C Houston (38 Phoenix, 33 Miami) |
| Streak | `persistence` | Same | Outdoor-work / “longest hostile run” |
| Optional | `time_of_measure` | Same day | “When does this block peak?” (hours 0–23 UTC — label timezone) |

Granularity **100**. Join **area-weighted** tile overlap (parcel method). Do not rank by TCM at pad scale (peaks collapse; duration does not).

### Once per AOI (centroid)

| Endpoint | Params | Use |
|---|---|---|
| `env_params` | Pass area-weighted TCM peak °C | Wet-bulb, apparent **at hot hour only**, RH, GHI. Never duration-from-`heat_index_celsius`. Coarser than tiles — say so. |
| `satellite` | `filter_type=3`, gran 80 | Impervious / canopy / vegetation / water buckets |
| `streetview` | `vertical_angle=10`, `horizontal_angle=90` | Sky vs tree vs building. Empty = “no panorama,” not 0% shade |
| `heat_intelligence` | `geographic`, `environmental`, `urban` | PDF download. Do not parse as a score |

LLM memo **after** numbers exist (cite-or-silence). Not a free-form agent looping FG (Track 6 clone + credits).

### Live vs demo

| User action | FG |
|---|---|
| Open app / click Houston preset | Cache only |
| Play slider | Cache only |
| Draw new polygon | 1 TCM 15:00 + 1 exceedance; enrich if `n_cells>0` |
| Phoenix | Date locked `2024-07-15`. Banner if `n_cells=0` |

---

## 7. Screens + 3-minute demo script

Live, **no login**. Bind `0.0.0.0:$PORT` if on Render.

### Screens

1. **3D map (hero)** — Houston EaDo / Midtown preset, pitch on, Carto light raster, FG heat fill, extruded massing, sun shadow, AOI outline. Draw tool (closed polygon) or two presets. Area readout; block >45 mi².  
2. **Time + sun** — hour slider 07–18, play, date locked to study day. Sun glyph.  
3. **Layers** — TCM °C, exceedance hours, buildings, shadows, satellite-class chips. Coverage-miss banner.  
4. **Scorecard** — Pass / price / caution. Rows: exceedance hours, persistence, shade hours 10:00–16:00 (geometry), wet-bulb hot hour, impervious %, sky %, height-coverage %.  
5. **Memo** — LLM paragraph + Heat Intelligence PDF.

No A/B pins. No OSRM polylines.

**Presets**

| ID | Place | Why |
|---|---|---|
| `houston-eado` | East Downtown / EaDo (~1.5–2 km²) | Construction + urban fabric, FG contrast, talk-track 1 |
| `houston-museum` | Museum District / Hermann Park edge | Cooler canopy contrast, same metro |
| `phoenix-2024-07-15` | Small downtown AOI | Second city; never `2026-08-17` |

### 3-minute script

| t | Say / do |
|---|---|
| 0:00 | “HeatCast is for planners and site PMs. FortyGuard 2 m air on a Houston block, plus sun on the massing. Not a cool walk. Not a city twin.” |
| 0:20 | Pitch the map. Heat tiles at 15:00, 15 Jul 2024. “Each cell is 100 m — neighborhood UHI, not this curb.” |
| 0:50 | Play 07:00→18:00. “Twelve cached TCM hours. Credits are tasks; we do not live-loop the API.” Shadows move with the same clock. |
| 1:20 | Click the pad. “N hours ≥ 35 °C this week (exceedance `activity_id=…`). Shade hours on the slab are from the extrusion + sun, not from FortyGuard.” |
| 1:50 | Toggle exceedance layer. Compare EaDo vs Museum preset: **N vs K hours**. Measurable before/after. |
| 2:15 | Streetview + satellite chips + wet-bulb. PDF. One LLM sentence that only restates those numbers. |
| 2:40 | Draw? Optional. Else: “Live draw is one snapshot + duration. The film is the judged AOI.” Coverage-miss banner if empty. |
| 2:55 | Cut-list one-liner: no CFD, no India, no walking routes. |

---

## 8. Cut-list

- Walking / Cool Route / OSRM / A→B pins  
- Bus-stop or parks audit (handbook notebooks)  
- Full-city or metro **digital twin**  
- Facade / street-canyon **CFD**, ENVI-met, tree-resolved shade  
- Google Photorealistic 3D, Cesium ion as the runtime  
- Pure Three.js rewrite  
- India / any non-US AOI (API is US-only)  
- 7-day hourly animation; live FG on slider  
- 60 m citywide film  
- HeatHall-as-hero (flood + EIA DC screener) — optional flood overlay later, not the title  
- Free-form agent that loops FortyGuard  
- Frontend API keys  
- Claiming FG returns 3D or shadows  
- Dollar OSHA fines / cooling OpEx as “measured”  
- OpenFreeMap as the only basemap  

**Rip from current HeatLens UI:** `osrm.py`, origin/destination click state, `score_route`, corridor buffer, “Fastest vs cooler walk.”  
**Keep:** FG client, disk cache, coverage-miss, secret stripping, city table (Phoenix date 2024-07-15), PDF route, Carto/Esri raster.

---

## 9. Keep MapLibre 2D as fallback? **Yes.**

You already lost maps once (dark Carto, then OpenFreeMap vectors blank, then Carto raster recovered). Judges get **one** live demo.

**Policy**

- Default: 3D (pitch + Three custom layer) when `map.getCanvas().getContext('webgl2')` or webgl works **and** the custom layer `onAdd` succeeds.  
- Fallback: existing 2D `HeatMap.tsx` path — Carto raster + GeoJSON heat fill + polygon, **no** walking markers.  
- Toggle in the header: “3D / 2D” so a laptop with a bad GPU is not a black screen.  
- Do not load OpenFreeMap styles for either path.  
- If Three `onAdd` throws: `console.warn`, set `use3d=false`, stay on 2D heat. Scorecard and slider still work (2D fill lerp).  
- Test on the **demo Windows machine** the day before: Chrome + Edge, hardware acceleration on and off.

2D is not a second product. It is the same AOI, same cached tiles, camera pitch 0.

---

## 10. 10-day build order (guidance only — not this task)

| Day | Ship |
|---|---|
| 1 | Kill walking. Polygon + presets. Confirm Carto heat on Houston 2024-07-15. Overpass/Overture height census. |
| 2–3 | Exceedance + persistence + scorecard. Pre-warm 12 TCM frames. |
| 4–5 | Pitch + extrude frozen buildings. Time slider on cache. |
| 6–7 | Three shadows + suncalc bound to slider. Shade-hours on pad. |
| 8 | Satellite / streetview / env_params / PDF / LLM memo. 2D fallback toggle. |
| 9 | Demo script rehearsal. Phoenix locked. Cache copied. WebGL fail test. |
| 10 | Buffer. Copy, captions, height-coverage badge. No new APIs. |

Two people: one FG/cache/scorecard, one MapLibre/Three/slider.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| OpenFreeMap / vector blank | Carto raster only; buildings from GeoJSON. |
| Shared GL context bugs (MapLibre + Three) | Copy the official shadow example; `resetState()`; 2D fallback. |
| OSM heights weak in Houston | Massing gizmo + coverage badge; skip city shadows if <40% area. |
| Animation burns credits | 12 precomputed frames; slider never calls FG. |
| Phoenix empty completed heatmap | Date lock; coverage-miss ≠ 0 °C. |
| `filter_type=4` vs stale limitations page (lists 1–3 only) | Try 4 for the week; fall back to `3` (one day). Cache whatever works. |
| Judges think 3D *is* FortyGuard | Voice-over + badge: tiles = FG; shadows = sun + boxes. |
| Cool Route look-alike | No routes. Twin is neighborhood, not city. |
| Render ephemeral disk | Pre-warm cache locally; do not “fill on first hit.” |
| `env_params` identical 1 km apart | Label point-scale. Duration from exceedance only. |

---

## 12. Honesty checklist (put on the map)

- FortyGuard: 2 m air, US, polygon tiles 60/80/100 m, °C or hours.  
- Shadows: computed, not observed.  
- 100 m ≠ sidewalk.  
- Default building height is a stand-in.  
- Animation frames are discrete heatmaps.  
- Completed 0-tile results are coverage misses.

---

## Sources

- [FortyGuard Hackathon’26](https://www.fortyguard.com/hackathon26) (Aug 2026)  
- [Create Heatmap docs](https://docs-api.fortyguard.com/docs/create-heatmap) (local: `../.firecrawl/docs-pages/create-heatmap.md`)  
- [Known Limitations](https://docs-api.fortyguard.com/docs/limitations) (local: `../.firecrawl/docs-pages/limitations.md`)  
- [API Pricing — what credits are](https://www.fortyguard.com/api-pricing)  
- [MapLibre: 3D model with shadow (Three.js)](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-with-shadow-using-threejs/)  
- [MapLibre: add 3D model using Three.js](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-using-threejs/)  
- [MapLibre: 3D tiles using Three.js](https://maplibre.org/maplibre-gl-js/docs/examples/add-3d-tiles-using-threejs/)  
- [MapLibre: display buildings in 3D](https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/)  
- [suncalc (mourner)](https://github.com/mourner/suncalc)  
- [Three.js shadows](https://threejs.org/manual/en/shadows.html)  
- [threebox](https://github.com/jscastro76/threebox/) / [building shadow example](https://github.com/jscastro76/threebox/blob/master/examples/14-buildingshadow.html)  
- [maplibre-gl-three (3D Tiles)](https://npm.io/package/maplibre-gl-three)  
- [deck.gl + MapLibre](https://github.com/visgl/deck.gl/blob/master/docs/developer-guide/base-maps/using-with-maplibre.md)  
- [Cesium ion pricing](https://cesium.com/platform/cesium-ion/pricing/)  
- [Cesium OSM Buildings](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/)  
- [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles)  
- [Overture Maps buildings](https://docs.overturemaps.org/guides/buildings/)  
- [Microsoft Building Footprint Data (OSM wiki)](https://wiki.openstreetmap.org/wiki/Microsoft_Building_Footprint_Data)  
- [OSM community: building heights](https://community.openstreetmap.org/t/building-heights/79205)  
- Local: [RESEARCH-PIVOT.md](./RESEARCH-PIVOT.md), `web/package.json` (`maplibre-gl@^6.4.1`), `web/src/components/HeatMap.tsx`, `api/app/fg.py`, `api/app/cache.py`
