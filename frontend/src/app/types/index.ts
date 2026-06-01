export type RiskClass = 'low' | 'medium' | 'high' | 'critical';
export type Trend = '↑' | '↓';

export interface Precursor {
  feature: string;
  value?: number;
  importance?: number;
  shap_value?: number;
  trend: Trend;
}

export interface UncertaintyBand {
  p10: number;
  p50: number;
  p90: number;
}

export interface SpikeProbability {
  in_batch: number | null;
  '5m': number | null;
  '10m': number | null;
  '15m': number | null;
}

export interface HybridPrediction {
  timestamp: string;
  entity_id: string;
  risk_score: number;
  risk_class: RiskClass;
  lead_time_minutes: number;
  predicted_deviation?: number;
  spike_probability?: SpikeProbability;
  top_precursors: Precursor[];
  temporal_attention: Record<string, number>;
  uncertainty_band: UncertaintyBand;
  trajectory_summary: string;
  confidence: number;
  model_versions: Record<string, string>;
}

export type PredictionResult = HybridPrediction;

export interface TagRecord {
  synthetic_id: string;
  tag_name: string;
  plant: string;
  recipe: string;
  raw_material: string;
  batch_id: string;
  shift: number;
  current_sp: number;
  current_pv: number;
  reading_count: number;
  last_10_readings: number[];
  batch_start_ts: string;
  current_deviation_pct: number;
  health_status: 'OK' | 'ALERT' | 'WARNING' | 'SEVERE' | 'CRITICAL';
}

export interface HealthCheckResponse {
  status: string;
  loaded_models: string[];
  tag_count: number;
}

export interface DashboardSettings {
  theme: 'dark' | 'light';
  updateFrequency: number;
  chartType: 'recharts' | 'plotly';
  replayMode: boolean;
  showAdvancedMetrics: boolean;
  autoRefresh: boolean;
}
