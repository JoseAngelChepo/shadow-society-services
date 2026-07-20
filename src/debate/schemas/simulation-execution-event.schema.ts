import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ExecutionEventLevel = 'debug' | 'info' | 'warn' | 'error';

export type SimulationExecutionEventDocument =
  HydratedDocument<SimulationExecutionEvent>;

@Schema({ collection: 'simulation_execution_events', timestamps: false })
export class SimulationExecutionEvent {
  @Prop({ required: true, index: true })
  simulationId!: string;

  @Prop({ required: true, index: true })
  executionId!: string;

  @Prop({ required: true })
  sequence!: number;

  @Prop({ required: true })
  type!: string;

  @Prop({ required: true, default: 'info' })
  level!: ExecutionEventLevel;

  @Prop({ required: true })
  phase!: string;

  @Prop()
  actor?: string;

  @Prop()
  round?: number;

  @Prop({ required: true })
  message!: string;

  @Prop({ type: Object })
  details?: Record<string, unknown>;

  @Prop({ required: true, default: 1 })
  schemaVersion!: number;

  @Prop({ required: true })
  occurredAt!: string;
}

export const SimulationExecutionEventSchema =
  SchemaFactory.createForClass(SimulationExecutionEvent);

SimulationExecutionEventSchema.index(
  { simulationId: 1, sequence: 1 },
  { unique: true },
);
