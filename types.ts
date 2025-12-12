
export enum AppMode {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  REFINING = 'REFINING',
  EDITING = 'EDITING',
  ANIMATING = 'ANIMATING'
}

export interface Point {
  x: number;
  y: number;
}

// Stage 0 Data
export interface RefinementResult {
  imageUrl: string;
  metadata?: {
    resolution: string;
    refinement_strength: number;
    num_gaps_repaired: number;
    note: string;
  };
}

// --- SIMPLIFIED ANALYSIS TYPES (V2) ---

export interface RawPoint {
  x: number; // 0-10000 integer
  y: number; // 0-10000 integer
  z?: number; // Normalized Thickness (0-10000 scale relative to canvas width)
  a?: number; // Opacity (0-1)
}

export interface Stroke {
  points: RawPoint[];
  pressure?: number[];
  type?: 'stroke' | 'dot';
}

export interface SignatureAnalysis {
  strokes: Stroke[];
  metadata: {
    original_size: [number, number];
    notes: string;
  };
  // Deprecated fields explicit removal to ensure type safety
  level1_graph?: never;
  level2_graphs?: never;
}

// --- MOTION PLANNER TYPES ---

export interface PhysicsPoint {
  x: number;
  y: number;
  time: number;      // Global timestamp (ms) when pen reaches this point
  lineWidth: number;
  opacity: number;
}

export interface StrokePath {
  id: string;
  points: PhysicsPoint[];
  startTime: number;
  endTime: number;
}

// Preset Types
export type HandwritingStyleKey = 'smooth_cursive' | 'rigid_formal' | 'flowing_dynamic';

export interface HandwritingStyle {
  label: string;
  speed_multiplier: number;
  base_ms_per_px: number;
  easing_start: string;
  easing_end: string;
  pressure_curve: string;
  pressure_scale: number;
  micro_tremor_amp_px: number;
  micro_tremor_freq_hz: number;
  overshoot_intensity: number;
  ink_spread: 'light' | 'medium' | 'heavy';
  slant_angle_deg: number;
  inertia_factor: number;
  connection_smoothing: string;
}
