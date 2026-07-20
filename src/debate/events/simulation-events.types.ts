import type { ExecutionEventLevel } from '../schemas/simulation-execution-event.schema';

export type ExecutionEvent = {
  simulationId: string;
  executionId: string;
  sequence: number;
  type: string;
  level: ExecutionEventLevel;
  phase: string;
  actor?: string;
  round?: number;
  message: string;
  details?: Record<string, unknown>;
  schemaVersion: number;
  occurredAt: string;
};

export type AppendExecutionEvent = {
  simulationId: string;
  executionId: string;
  type: string;
  level?: ExecutionEventLevel;
  phase: string;
  actor?: string;
  round?: number;
  message: string;
  details?: Record<string, unknown>;
};
