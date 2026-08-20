# HeatCast

Urban-planner simulator for **FortyGuard Hackathon’26** (Team HumanSlop · FG-141). FastAPI + Next.js + MapLibre.

FortyGuard 2 m air tiles (`tcm` + **exceedance hours**) on a Houston district. **2D** is the scorecard. **3D** is pitched OSM massing. **Add trees** is a labeled literature overlay — FortyGuard does **not** return a new heatmap.

Tiles are ~100 m. Not sidewalk CFD. API key stays on the server.

See [RESEARCH-SIMULATOR.md](./RESEARCH-SIMULATOR.md) for APIs and the scenario formula.

## Honesty

- Scenario cooling is **model, not FG measurement** (≈ 0.10–0.20 °C per +10% canopy, cap 2 °C).
- Phoenix `2026-08-17` can complete with 0 tiles (still billed). Use **`2024-07-15`**. Houston EaDo has contrast.
- `heat_index` is not duration. Rain is Open-Meteo context, not a hydro model.
- Failed FG tasks are free; empty successful heatmaps still cost. Cache AOI+datetime+analytic_type.

## Run

API key in `api/.env` as `FORTYGUARD_API_KEY` (gitignored). Optional: `LLM_API_KEY` or `OPENAI_API_KEY` for the planner brief.

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

Open http://localhost:3000. Default district: **Houston EaDo**, date **2024-07-15 15:00**.
