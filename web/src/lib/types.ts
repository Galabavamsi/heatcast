export type LatLon = { lat: number; lon: number; name?: string };

export type City = {
  id: string;
  name: string;
  city_name?: string;
  blurb: string;
  center: { lon: number; lat: number };
  zoom: number;
  bbox?: [number, number, number, number];
  default_date: string;
  default_time: string;
  threshold_c: number;
  mode?: string;
  aoi?: GeoJSON.FeatureCollection;
};

export type ScenarioEstimate = {
  kind?: string;
  metric?: string;
  not_used?: string;
  label?: string;
  canopy_delta_pct_requested?: number;
  canopy_delta_pct: number;
  current_canopy_pct?: number | null;
  estimated_delta_c: number;
  estimated_delta_c_range: { low: number; high: number };
  estimated_hours_saved: number | null;
  estimated_hours_saved_range?: { low: number | null; high: number | null };
  estimated_mean_c?: number | null;
  citations?: Array<{ title: string; url?: string | null; note?: string }>;
  formula?: Record<string, unknown>;
};

export type RainContext = {
  ok?: boolean;
  source?: string;
  daily_precip_mm: number | null;
  precip_hours?: number | null;
  hour_precip_mm?: number | null;
  attribution?: string;
  caveat?: string;
  cached?: boolean;
};

export type ComfortContext = {
  temp_c: number | null;
  rh_pct: number | null;
  wind_ms: number | null;
  apparent_c: number | null;
  heat_index_c: number | null;
  category: string | null;
  metric?: string;
  note?: string;
};

export type HoursLayer = {
  activity_id: string | null;
  mean_hours: number | null;
  max_hours: number | null;
  units: string;
  analytic_type?: string;
  heatmap?: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry: { type: string; coordinates: unknown };
      properties: {
        tile_id?: string | number | null;
        temperature?: number | null;
        hours?: number | null;
        value?: number | null;
        measured_c?: number | null;
        overlay?: boolean;
        delta_c?: number | null;
        delta_abs?: number | null;
        grad?: number | null;
      };
    }>;
  };
};

export type DeltaLayer = {
  activity_id: string | null;
  start_activity_id?: string | null;
  end_activity_id?: string | null;
  mean_delta: number | null;
  max_delta: number | null;
  min_delta: number | null;
  delta_abs_mean?: number | null;
  n_matched: number;
  units: string;
  hour?: string;
  start_date?: string;
  end_date?: string;
  note?: string;
  analytic_type?: string;
  heatmap?: HoursLayer["heatmap"];
};

export type WalkRoute = {
  ok: boolean;
  type?: string;
  coordinates?: [number, number][];
  distance_m?: number;
  duration_s?: number;
  profile?: string;
  source?: string;
  note?: string;
};

export type AnalyzeResponse = {
  city: { id: string; name: string; mode?: string };
  place_name?: string;
  aoi: GeoJSON.FeatureCollection;
  bbox?: [number, number, number, number];
  aoi_area_mi2: number;
  centroid?: { lat: number; lon: number };
  scorecard: {
    mean_c: number | null;
    max_c: number | null;
    min_c: number | null;
    share_above_threshold: number | null;
    threshold_c: number;
    mean_hours_above: number | null;
    max_hours_above: number | null;
    mean_streak_hours?: number | null;
    max_streak_hours?: number | null;
    unrelieved_heat_ratio?: number | null;
    unrelieved?: {
      ratio: number;
      label?: string;
      formula?: string;
      citation_title?: string;
      citation_url?: string;
      osha_nprm_url?: string;
      note?: string;
    } | null;
  };
  rain?: RainContext | null;
  comfort?: ComfortContext | null;
  flood?: { zone?: string | null; subtype?: string | null; caveat?: string } | null;
  scenario?: ScenarioEstimate;
  scenario_model?: { label?: string };
  memo: string;
  memo_meta?: { source?: string; model?: string | null };
  heatmap: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry: { type: string; coordinates: unknown };
      properties: {
        tile_id?: string | number | null;
        temperature: number | null;
        hours?: number | null;
        value?: number | null;
        measured_c?: number | null;
        overlay?: boolean;
      };
    }>;
  };
  exceedance: HoursLayer | null;
  persistence?: HoursLayer | null;
  delta?: DeltaLayer | null;
  stats: {
    n_cells: number;
    feature_count: number;
    units: string;
    mean: number | null;
    max: number | null;
    min: number | null;
  };
  hotspot: { lon: number; lat: number; temperature_c: number | null; tile_id?: string | number | null } | null;
  warning: string | null;
  coverage_miss: boolean;
  confidence: {
    activity_id: string | null;
    datetime: string;
    units: string;
    tile_count: number;
    n_cells: number;
    coverage_miss: boolean;
    cached: boolean;
    city_id: string;
    granularity_m: number;
    filter_type: number;
    duration_filter_type?: number;
    duration_days?: number;
    end_date?: string | null;
    duration_note?: string;
    analytic_type: string;
    threshold_c: number;
    scale_note?: string;
  };
  activity_ids: { tcm: string | null; exceedance: string | null; persistence?: string | null; tcm_end?: string | null };
};

export type EnrichResponse = {
  lat: number;
  lon: number;
  temperature_c: number;
  env_params: {
    caveat: string;
    requested_hour: Record<string, unknown>;
    hot_hour: Record<string, unknown>;
    precipitation_mm?: number | null;
  } | null;
  satellite: {
    classes_percent: Record<string, number>;
    buckets?: {
      canopy_pct: number;
      impervious_pct: number;
      vegetation_pct: number;
      water_pct: number;
      note?: string;
    };
  } | null;
  streetview: { classes_percent: Record<string, number> } | null;
  heat_intelligence: {
    filename: string;
    download_url: string;
    activity_id: string;
  } | null;
  errors: Record<string, string> | null;
};

export type HourlyWeather = {
  times: string[];
  temp_c: Array<number | null>;
  rh_pct: Array<number | null>;
  apparent_c: Array<number | null>;
  ghi_wm2: Array<number | null>;
  source?: string;
  attribution?: string;
  caveat?: string;
};

export type AqiSeries = {
  ok?: boolean;
  source?: string;
  us_aqi: Array<number | null>;
  pm25?: Array<number | null>;
  times?: string[];
  attribution?: string;
  caveat?: string;
  cached?: boolean;
};

export type PeakHourRow = {
  hour: string;
  temp_c: number | null;
  heat_load: number;
  ghi_wm2: number | null;
  above_threshold: boolean;
};

export type PeakHours = {
  kind: string;
  metric?: string;
  not_used?: string;
  threshold_c: number;
  hours: PeakHourRow[];
  heat_load_sum: number;
  hours_above: number;
  hottest: { hour: string; temp_c: number; index?: number } | null;
  unrelieved_streak_h: number;
  unrelieved_window: { start: string | null; end: string | null } | null;
  solar_peak: { hour: string; ghi_wm2: number; temp_c?: number | null } | null;
  label?: string;
};

export type CompoundHourRow = {
  hour: string;
  temp_c: number | null;
  rh_pct: number | null;
  us_aqi: number | null;
  hot: boolean;
  humidity_compound: boolean;
  aqi_compound: boolean;
  compound: boolean;
};

export type CompoundHours = {
  kind: string;
  not_used?: string;
  threshold_c: number;
  rh_cut: number;
  aqi_cut: number;
  has_us_aqi: boolean;
  has_humidity: boolean;
  hours: CompoundHourRow[];
  compound_hours: number;
  humidity_compound_hours: number;
  aqi_compound_hours: number;
  label?: string;
  aqi_note?: string | null;
};

export type HoursResponse = {
  lat: number;
  lon: number;
  date: string;
  time: string;
  timezone?: string;
  threshold_c: number;
  hourly: HourlyWeather | null;
  aqi: AqiSeries | null;
  peak: PeakHours;
  compound: CompoundHours;
  comfort?: ComfortContext | null;
};

export type WalkExposureSample = {
  lon: number;
  lat: number;
  along_m: number;
  temp_c: number | null;
  hours?: number | null;
  tile_id?: string | number | null;
};

export type WalkExposure = {
  ok: boolean;
  kind?: string;
  not_used?: string;
  threshold_c?: number;
  samples: WalkExposureSample[];
  mean_c?: number | null;
  max_c?: number | null;
  share_above?: number | null;
  hottest_stretch?: {
    start_index: number;
    end_index: number;
    mean_c: number;
    max_c: number;
    from_m?: number | null;
    to_m?: number | null;
  } | null;
  distance_m?: number;
  label?: string;
  note?: string;
};

export type WeatherResponse = {
  city_id?: string;
  lat: number;
  lon: number;
  date: string;
  timezone?: string;
  rain: RainContext | null;
  comfort?: ComfortContext | null;
  hourly?: HourlyWeather | null;
  aqi?: AqiSeries | null;
  flood?: { zone?: string | null; subtype?: string | null; caveat?: string } | null;
  elevation_m?: number | null;
};

export type BuildingsResponse = GeoJSON.FeatureCollection & {
  meta?: { count: number; height_coverage?: number; note?: string; error?: string };
};

export type CoolingSite = {
  name: string;
  kind: string;
  kindKey?: string;
  walkOk: boolean;
  lon: number;
  lat: number;
};

export type CoolingResponse = GeoJSON.FeatureCollection & {
  meta?: { count: number; note?: string; error?: string };
};

export type SviTract = {
  fips: string;
  name: string;
  location?: string | null;
  county?: string | null;
  state?: string | null;
  svi: number;
  svi_pct: number;
  theme1?: number | null;
  theme2?: number | null;
  theme3?: number | null;
  theme4?: number | null;
  population?: number | null;
  high_svi?: boolean;
  mean_c?: number | null;
  max_c?: number | null;
  tile_count?: number | null;
  heat_norm?: number | null;
  priority?: number | null;
  in_hottest_third?: boolean;
};

export type SviResponse = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string | number;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    properties: SviTract;
  }>;
  summary: {
    tract_count: number;
    max_svi: number | null;
    mean_svi: number | null;
    highest_svi_name: string | null;
    high_svi_hottest_third: number;
    planner_sentence: string;
    priority_formula: string;
    source: string;
    source_url: string;
    cached: boolean;
    joined: boolean;
    year?: number;
  };
  top_priority: SviTract[];
};
