export type DebateMode = 'mirror' | 'shadow';

export type QwenModelId =
  | 'qwen-plus'
  | 'qwen-turbo'
  | 'qwen-max';

export type AgentRole =
  | 'judge'
  | 'defender'
  | 'accuser'
  | 'public'
  | 'mediator';

export type MutationSpeed = 'fast' | 'normal';

export type SimulationStatus =
  | 'configured'
  | 'running'
  | 'completed'
  | 'failed';

export type MutationConfig = {
  intensity: number; // 0-100
  publicInfluence: boolean;
  speed: MutationSpeed;
};

export type SimulationConfig = {
  topic: string;
  model: QwenModelId | string;
  mode: DebateMode;
  mutations: MutationConfig;
  totalRounds: number;
};

export type AgentMessage = {
  id: string;
  round: number;
  role: AgentRole;
  agentName: string;
  content: string;
  createdAt: string;
};

export type ScoreBreakdown = {
  persuasion: number; // 0-10
  coherence: number; // 0-10
  effectiveness: number; // 0-10
  contradictionPenalty: number; // 0-10 points deducted (applied as weight)
  total: number; // 0-10 weighted
};

export type RoundJudgment = {
  round: number;
  defenderScore: ScoreBreakdown;
  accuserScore: ScoreBreakdown;
  winner: 'defender' | 'accuser' | 'tie';
  rationale: string;
  mode: DebateMode;
  usedLlm: boolean;
  fallback?: {
    errorCode: string;
    requestId?: string;
    moderationBlocked: boolean;
  };
};

export type AudienceState = {
  defender: number; // 0-100 share
  accuser: number;
};

export type MutationEvent = {
  round: number;
  favoredSide: 'defender' | 'accuser';
  temperatureBoost: number;
  promptHint: string;
  audience: AudienceState;
  publicVotes?: Array<{
    voter: number;
    favoredSide: 'defender' | 'accuser';
    reason: string;
  }>;
};

export type SimulationMetrics = {
  societalRevealIndex: number | null;
  moralDecayScore: number | null;
  audienceGrowth: AudienceState;
  convergenceSpeedRounds: number | null;
  averagePersuasionShadow?: number | null;
  averageCoherenceMirror?: number | null;
};

export type ModerationActor =
  | 'defender'
  | 'accuser'
  | 'mediator'
  | 'judge'
  | 'public';

export type ModerationEvent = {
  round: number;
  actor: ModerationActor;
  provider: 'dashscope';
  errorCode: string;
  requestId?: string;
  primaryCategory: 'content_moderation_filter';
  confidence: 'high';
  inspectionStage: 'input_or_output_unknown';
  explanation: string;
  possibleUnderlyingMechanisms: Array<
    'safety_alignment' | 'corporate_policy' | 'contextual_risk_detection'
  >;
  occurredAt: string;
};

export type Simulation = {
  id: string;
  status: SimulationStatus;
  config: SimulationConfig;
  currentRound: number;
  messages: AgentMessage[];
  judgments: RoundJudgment[];
  mutations: MutationEvent[];
  audience: AudienceState;
  metrics: SimulationMetrics;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  warnings?: string[];
  moderationEvents?: ModerationEvent[];
  eventSequence?: number;
  executionId?: string;
  executionLease?: {
    leaseId: string;
    expiresAt: string;
  };
};
