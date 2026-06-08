// ============================================================================
// tag3 — Type-aware tag contracts for PSM / Sigma / Silo / Packaging zones
// Parsed from OPC-UA telemetry. See MASTER IMPLEMENTATION spec.
// ============================================================================

// ---- Common envelope (every row from the IoT stream) -----------------------
export interface RawTagRow {
  IotDeviceId: string;   // 'uaq-lakme-hul-iotedge-01'
  SensorId: string;      // 'opcua'
  SiteId: string;        // 'LLPL'
  MachineId: string;
  Tag: string;
  Value: string | number;
  TS: string;            // e.g. '4/26/2026, 6:00:15.199 AM'
}

export type TagType = 'PSM' | 'SIGMA' | 'SILO' | 'PACKAGING' | 'UNKNOWN';
export type StatusCode = 1 | 2 | 3;

// ---- PSM --------------------------------------------------------------------
export interface PsmParsed {
  kind: 'PSM';
  D: string;        // Julian date YYYYDDD e.g. '202641'
  S: StatusCode;    // 1=idle/ready, 2=dosing, 3=complete
  B: number;        // batch counter 0–39
  R: string;        // recipe name
  RM: string;       // raw material
  SP: number;       // setpoint weight (kg)
  PV: number;       // process value / actual weight dosed (kg)
}

// ---- Sigma Mixer ------------------------------------------------------------
/** Mixer identity across all six cascades. */
export type SigmaMixer = 'MX1' | 'MX2' | 'MX3' | 'MX4' | 'MX5' | 'MX6';

/** Raw materials seen across the live Sigma cascades.
 *  Note: the historian has both 'GLYCERINE' and 'Glycrine' spellings —
 *  validation accepts either. */
export const SIGMA_RAW_MATERIALS = [
  'Colour', 'DTP', 'GLYCERINE', 'Glycrine', 'LIQUID', 'Lauric', 'Liquid',
  'Noodle', 'PAS', 'Perfume', 'Powder', 'ST', 'STARCH',
] as const;

/** Recognised rework codes seen in the historian. */
export const SIGMA_REWORK_CODES = [0, 30] as const;

export interface SigmaParsed {
  kind: 'SIGMA';
  D: string;
  S: StatusCode;
  B: number;
  R: string;        // recipe code e.g. 'LMST5R5_LBGRMEXP+_600KG'
  RM: string;       // e.g. 'Lauric', 'PAS', 'Glycrine', 'Colour', ...
  SP: number;
  PV: number;
}

export interface SigmaBarcode {
  kind: 'SIGMA_BARCODE';
  mixer: SigmaMixer;
  barcodeValue: string;
  isIdle: boolean;  // true when value === 'Scan Barcode'
}

export interface SigmaRework {
  kind: 'SIGMA_REWORK';
  mixer: SigmaMixer;
  reworkValue: number; // 0 = normal, > 0 = rework active
}

/** Sigma structural tags (RECIPE_NAME, BATCHCOUNTER) — analogous to PSM_TELEMETRY. */
export interface SigmaTelemetryParsed {
  kind: 'SIGMA_TELEMETRY';
  mixer: SigmaMixer;
  tagType: 'BATCHCOUNTER' | 'RECIPE_NAME';
  value: number | string;
}

// ---- Silo -------------------------------------------------------------------
export interface SiloNoodleType {
  kind: 'SILO';
  tagType: 'noodle_type';
  siloId: string;     // 'Day_silo_1', 'Buffer_silo_3'
  noodleType: string;
}

export interface SiloBagOut {
  kind: 'SILO';
  tagType: 'bagout_detail';
  stationId: string;  // 'Stn_01' | 'Stn_02'
  batchId: string;
  SP: number;
  PV: number;
  noodleType: string;
  isIdle: boolean;    // true when value === ','
}

export interface SiloBarcodeTag {
  kind: 'SILO';
  tagType: 'barcode';
  stationId: string;
  barcodeValue: string;
  isIdle: boolean;
}

export interface SiloWarehouseBarcode {
  kind: 'SILO';
  tagType: 'warehouse_barcode';
  batchId: string;
  weight: number;
  noodleType: string;
  count: number;
}

export interface SiloShreejiBarcode {
  kind: 'SILO';
  tagType: 'shreeji_barcode';
  barcodeId: string;
  /** Middle indicator from `id,MODE,weight`. Typically the literal `"PV"`. */
  mode: string;
  weight: number;
}

export type SiloParsed =
  | SiloNoodleType
  | SiloBagOut
  | SiloBarcodeTag
  | SiloWarehouseBarcode
  | SiloShreejiBarcode;

// ---- Packaging --------------------------------------------------------------
export interface PackagingParsed {
  kind: 'PACKAGING';
  wrapperName: string;          // 'WRA10', 'ACMA1'
  cascade: 'CAS3' | 'CAS5_6';
  currentGrams: number;
  targetGrams: number;
}

// ---- PSM Telemetry structural tags ------------------------------------------
export type PsmTelemetryTagType = 'Batch_PV_Weight' | 'Batch_SP_Weight' | 'Batch_Counter' | 'Noodle_Name';

export interface PsmTelemetryParsed {
  kind: 'PSM_TELEMETRY';
  tagType: PsmTelemetryTagType | string;
  value: number | string;
}

// ---- Unknown / unparseable --------------------------------------------------
export interface UnknownParsed {
  kind: 'UNKNOWN';
  raw: string | number;
}

export type ParsedTagValue =
  | PsmParsed
  | PsmTelemetryParsed
  | SigmaParsed
  | SigmaBarcode
  | SigmaTelemetryParsed
  | SigmaRework
  | SiloParsed
  | PackagingParsed
  | UnknownParsed;

// ---- Unified view -----------------------------------------------------------
export type ZoneType = 'PSM' | 'SIGMA' | 'SILO' | 'PACKAGING';

/** All possible health/state labels surfaced in the unified table. */
export type HealthStatus =
  | 'OK' | 'ALERT' | 'WARNING' | 'SEVERE' | 'CRITICAL'
  | 'IDLE' | 'ACTIVE' | 'DOSING' | 'COMPLETE' | 'NORMAL'
  | 'IN-SPEC' | 'OUT-OF-SPEC' | 'FROZEN' | 'OFFLINE' | 'SCANNED';

/** Status buckets used by the multi-status filter (collapse minor variants). */
export type StatusBucket = 'GOOD' | 'WARNING' | 'CRITICAL' | 'IDLE';

export const STATUS_TO_BUCKET: Record<HealthStatus, StatusBucket> = {
  OK: 'GOOD', NORMAL: 'GOOD', COMPLETE: 'GOOD', 'IN-SPEC': 'GOOD', ACTIVE: 'GOOD', SCANNED: 'GOOD',
  ALERT: 'WARNING', WARNING: 'WARNING', DOSING: 'WARNING',
  SEVERE: 'CRITICAL', CRITICAL: 'CRITICAL', 'OUT-OF-SPEC': 'CRITICAL', FROZEN: 'CRITICAL', OFFLINE: 'CRITICAL',
  IDLE: 'IDLE',
};

/** Unified row shape used by the merged zones table. */
export interface UnifiedTagRow {
  zone: ZoneType;
  id: string;            // unique row id (zone + tag/entity)
  tag: string;           // full tag string
  shortTag: string;      // last dotted segment
  /** Sub-type label visible in the table and used by per-zone filter dropdowns.
   *  E.g. 'BATCH'/'BARCODE'/'REWORK' for SIGMA, 'noodle_type'/'bagout_detail'/'barcode'/'warehouse_barcode'/'shreeji_barcode' for SILO, wrapper name for PACKAGING, RM for PSM. */
  subtype?: string;
  machineId: string;
  batchKey: string;      // group key for batch health
  recipe?: string;
  rm?: string;
  batchId?: string;
  status: HealthStatus;
  bucket: StatusBucket;
  passing: boolean;      // 'GOOD' = passing (only counted when dataAvailable)
  /** RICH: structured SP/PV/dev or composite CSV data we can apply rules to.
   *  Noodle-type labels, idle barcodes, idle bagouts → false. */
  dataAvailable: boolean;
  sp?: number;
  pv?: number;
  dev?: number;
  latestValue: string;
  ts: string;
  /** Unix milliseconds for sortable timestamps (0 when unparseable). */
  tsUtc: number;
  /** PSM only: last 10 PV readings (most-recent last). Used for history chart. */
  last10?: number[];
}

export interface BatchHealth {
  batchKey: string;
  total: number;
  passing: number;
  score: number;         // 0-100
}

// ---- Validation -------------------------------------------------------------
export type Severity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface ValidationResult {
  ruleId: string;
  severity: Severity;
  passed: boolean;
  message: string;
}

export interface ValidationAlert extends ValidationResult {
  tagName: string;
  machineId: string;
  ts: Date;
}

// ---- Per-tag stateful tracking ---------------------------------------------
export interface TagState {
  lastTS: Date | null;
  lastValue: any;
  previousPV: number | null;
  previousSP: number | null;
  previousB: number | null;
  previousR: string | null;
  consecutiveIdenticalCount: number;
  consecutiveNonZeroReworkCount: number;
  /** Timestamps of non-zero rework events in the rolling 60-min window. SMX-15. */
  reworkEvents?: Date[];
}

// ---- Zone snapshots ---------------------------------------------------------
export interface SigmaMixerSnapshot {
  batch: SigmaParsed | null;
  barcode: SigmaBarcode | null;
  rework: SigmaRework | null;
  barcodeIdleSince: Date | null;
  alerts: ValidationAlert[];
}

export interface SigmaSnapshot {
  mx1: SigmaMixerSnapshot;
  mx2: SigmaMixerSnapshot;
}

export interface SiloSnapshot {
  daySilos: Map<number, string>;       // 1..6 -> noodle type
  bufferSilos: Map<number, string>;    // 1..5 -> noodle type
  stations: Map<string, SiloBagOut>;   // 'Stn_01' -> detail
  stationBarcodes: Map<string, SiloBarcodeTag>;
  warehouse: SiloWarehouseBarcode | null;
  shreeji: SiloShreejiBarcode | null;
  alerts: ValidationAlert[];
}

export interface PackagingSnapshot {
  wrappers: Map<string, PackagingParsed>;
  alerts: ValidationAlert[];
}

// ---- Zone column-level filter state -----------------------------------------
export interface ZoneFilters {
  psm:       { recipe: string; rm: string; plant: string; subtype: string };
  sigma:     { mixer: string; recipe: string; subtype: string };
  silo:      { subtype: string; station: string; noodle: string };
  packaging: { cascade: string; wrapper: string };
}

export const EMPTY_ZONE_FILTERS: ZoneFilters = {
  psm:       { recipe: 'ALL', rm: 'ALL', plant: 'ALL', subtype: 'ALL' },
  sigma:     { mixer: 'ALL', recipe: 'ALL', subtype: 'ALL' },
  silo:      { subtype: 'ALL', station: 'ALL', noodle: 'ALL' },
  packaging: { cascade: 'ALL', wrapper: 'ALL' },
};

export interface ZoneFilterEvent {
  zone: keyof ZoneFilters;
  key:  string;
  value: string;
}

// ============================================================================
// Constants (from real data)
// ============================================================================

export const VALID_NOODLE_TYPES = [
  'JASMINE NOODLES',
  'PLUMERIA NOODLES',
  'SERGIO 56 NOODLES',
  'TEXAS MOD NOODLES',
  'GALAXY NOODLES',
  '20 PKO TULIP NOODLES',
  'LILAC NOODLES',
];

export const WRAPPER_TARGETS: Record<string, { target: number; cascade: 'CAS3' | 'CAS5_6' }> = {
  // TSPCAS3 namespace
  WRA2:  { target: 100, cascade: 'CAS3' },
  WRA3:  { target: 100, cascade: 'CAS3' },
  WRA4:  { target: 100, cascade: 'CAS3' },
  WRA5:  { target: 150, cascade: 'CAS3' },
  WRA6:  { target: 150, cascade: 'CAS3' },
  WRA7:  { target: 125, cascade: 'CAS3' },
  WRA8:  { target: 125, cascade: 'CAS3' },
  WRA9:  { target: 125, cascade: 'CAS3' },
  ACMA1: { target: 40,  cascade: 'CAS3' },
  // NEW_TSP.CAS5_6 namespace
  WRA10: { target: 41, cascade: 'CAS5_6' },
  WRA11: { target: 41, cascade: 'CAS5_6' },
  WRA12: { target: 41, cascade: 'CAS5_6' },
  WRA13: { target: 39, cascade: 'CAS5_6' },
  WRA14: { target: 39, cascade: 'CAS5_6' },
  WRA15: { target: 39, cascade: 'CAS5_6' },
  WRA16: { target: 39, cascade: 'CAS5_6' },
};

// Wrappers from non-default machine IDs (default = '8005000043300')
export const WRAPPER_MACHINE_MAP: Record<string, string> = {
  WRA3: '800500104343-1',
  ACMA1: '800500104343-1',
  WRA16: '800500005279-0',
};
export const DEFAULT_WRAPPER_MACHINE_ID = '8005000043300';

// RM-specific setpoint ranges (kg) for reference/plausibility (PSM)
export const RM_SP_RANGES: Record<string, { min: number; max: number }> = {
  EDTA:      { min: 1.65,   max: 2.05 },
  EHDP:      { min: 4.9,    max: 5.1 },
  AOS:       { min: 35.0,   max: 36.5 },
  Salt:      { min: 10.4,   max: 10.85 },
  Water:     { min: 9.8,    max: 10.2 },
  Caustic:   { min: 326,    max: 330 },
  DFA:       { min: 840,    max: 846 },
  EMILY:     { min: 32.5,   max: 33.5 },
  GLYCERINE: { min: 43.6,   max: 44.0 },
};

// Station setpoints for silo bag-out
export const STATION_SP: Record<string, number> = {
  Stn_01: 850,
  Stn_02: 900,
};

// Expected polling intervals (seconds) per tag type, for gap detection
export const EXPECTED_INTERVAL_S: Record<TagType, number> = {
  PSM: 60,
  SIGMA: 120,
  SILO: 60,
  PACKAGING: 120,
  UNKNOWN: 60,
};

export const PRODUCTION_HOURS = { start: 6, end: 22 }; // 06:00–22:00 IST
export const GAP_COMMS_DROP_S = 300;       // 5 min
export const GAP_OVERNIGHT_S = 43200;      // 12 h
