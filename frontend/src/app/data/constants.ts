import { RiskClass } from '../types';

export const RISK_CONFIG: Record<RiskClass, { color: string; bgColor: string; label: string; description: string }> = {
  low: {
    color: '#22c55e',
    bgColor: 'bg-risk-low/10',
    label: 'Low',
    description: 'Process stable, nominal operation',
  },
  medium: {
    color: '#f59e0b',
    bgColor: 'bg-risk-medium/10',
    label: 'Medium',
    description: 'Early precursor activity, increased monitoring recommended',
  },
  high: {
    color: '#ef4444',
    bgColor: 'bg-risk-high/10',
    label: 'High',
    description: 'Significant precursor cascade, intervention preparation needed',
  },
  critical: {
    color: '#dc2626',
    bgColor: 'bg-risk-critical/10',
    label: 'Critical',
    description: 'Imminent event, immediate intervention required',
  },
};

export const RISK_THRESHOLDS = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1.0,
} as const;

export const ZONES = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E'] as const;
export const RECIPES = ['Recipe 1', 'Recipe 2', 'Recipe 3', 'Recipe 4', 'Recipe 5'] as const;

export const API_CONFIG = {
  baseURL: 'http://localhost:5050',
  timeout: 10000,
  retryAttempts: 3,
  retryDelay: 1000,
} as const;
