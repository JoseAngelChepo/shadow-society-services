import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type LlmTraceEntry = {
  type: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  details?: Record<string, unknown>;
};

export type LlmTraceCallback = (
  entry: LlmTraceEntry,
) => void | Promise<void>;

type ChatJsonParams = {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  trace?: LlmTraceCallback;
};

type QwenErrorBody = {
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
  request_id?: string;
};

export class QwenApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'QwenApiError';
  }

  get isModerationBlock(): boolean {
    return (
      this.code === 'data_inspection_failed' ||
      this.code === 'inappropriate_content' ||
      this.code === 'inappropriate-content'
    );
  }

  get isRetryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

@Injectable()
export class QwenLlmService {
  private readonly logger = new Logger(QwenLlmService.name);
  private readonly timeoutMs = 45_000;
  private readonly maxAttempts = 3;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('DASHSCOPE_API_KEY')?.trim());
  }

  defaultModel(): string {
    return (
      this.config.get<string>('QWEN_DEFAULT_MODEL')?.trim() || 'qwen-plus'
    );
  }

  async chatJson<T>(params: ChatJsonParams): Promise<T> {
    const apiKey = this.config.get<string>('DASHSCOPE_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY not configured');
    }

    const baseUrl =
      this.config.get<string>('QWEN_BASE_URL')?.replace(/\/$/, '') ||
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    const model = params.model?.trim() || this.defaultModel();

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      await this.emitTrace(params.trace, {
        type: 'llm.request.started',
        message: `Qwen request attempt ${attempt} started.`,
        details: {
          attempt,
          model,
          temperature: params.temperature ?? 0.5,
          maxTokens: params.maxTokens ?? 900,
          systemPrompt: params.system,
          userPrompt: params.user,
        },
      });
      try {
        const response = await this.request({
          ...params,
          apiKey,
          baseUrl,
          model,
        });
        await this.emitTrace(params.trace, {
          type: 'llm.request.completed',
          message: `Qwen request attempt ${attempt} completed.`,
          details: {
            attempt,
            model,
            durationMs: Date.now() - startedAt,
            providerResponseId: response.responseId,
            providerRequestId: response.requestId,
            usage: response.usage,
            rawOutput: response.content,
          },
        });
        return this.parseJson<T>(response.content);
      } catch (err) {
        lastError = err;
        const retryable =
          (err instanceof QwenApiError && err.isRetryable) ||
          err instanceof TypeError ||
          err instanceof SyntaxError ||
          (err instanceof Error &&
            (err.name === 'AbortError' ||
              err.message === 'Empty LLM response' ||
              err.message === 'Failed to parse LLM JSON'));
        await this.emitTrace(params.trace, {
          type: 'llm.request.failed',
          level: 'warn',
          message: `Qwen request attempt ${attempt} failed.`,
          details: {
            attempt,
            model,
            durationMs: Date.now() - startedAt,
            errorName: err instanceof Error ? err.name : 'UnknownError',
            errorMessage: err instanceof Error ? err.message : String(err),
            status: err instanceof QwenApiError ? err.status : undefined,
            errorCode: err instanceof QwenApiError ? err.code : undefined,
            providerRequestId:
              err instanceof QwenApiError ? err.requestId : undefined,
            retryable,
          },
        });
        if (!retryable || attempt === this.maxAttempts) throw err;
        const delayMs = 350 * 2 ** (attempt - 1);
        this.logger.warn(
          `Qwen attempt ${attempt}/${this.maxAttempts} failed; retrying in ${delayMs}ms`,
        );
        await this.emitTrace(params.trace, {
          type: 'llm.request.retrying',
          level: 'warn',
          message: `Retrying Qwen request after ${delayMs}ms.`,
          details: { attempt, nextAttempt: attempt + 1, delayMs, model },
        });
        await this.delay(delayMs);
      }
    }
    throw lastError;
  }

  private async request(params: {
    apiKey: string;
    baseUrl: string;
    model: string;
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{
    content: string;
    responseId?: string;
    requestId?: string;
    usage?: Record<string, unknown>;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${params.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          temperature: params.temperature ?? 0.5,
          max_tokens: params.maxTokens ?? 900,
          messages: [
            { role: 'system', content: params.system },
            { role: 'user', content: params.user },
          ],
          response_format: { type: 'json_object' },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const rawBody = await response.text();
      const parsed = this.parseErrorBody(rawBody);
      const code =
        parsed.error?.code ?? parsed.error?.type ?? `http_${response.status}`;
      const message = parsed.error?.message ?? `Qwen API ${response.status}`;
      const error = new QwenApiError(
        message,
        response.status,
        code,
        parsed.request_id,
      );
      const log = `Qwen ${response.status} ${code}${
        parsed.request_id ? ` (${parsed.request_id})` : ''
      }: ${message.slice(0, 240)}`;
      if (error.isModerationBlock) this.logger.warn(log);
      else this.logger.error(log);
      throw error;
    }

    const data = (await response.json()) as {
      id?: string;
      request_id?: string;
      usage?: Record<string, unknown>;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');
    return {
      content,
      ...(data.id ? { responseId: data.id } : {}),
      ...(data.request_id ? { requestId: data.request_id } : {}),
      ...(data.usage ? { usage: data.usage } : {}),
    };
  }

  private parseErrorBody(body: string): QwenErrorBody {
    try {
      return JSON.parse(body) as QwenErrorBody;
    } catch {
      return { error: { message: body || 'Unknown Qwen API error' } };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async emitTrace(
    callback: LlmTraceCallback | undefined,
    entry: LlmTraceEntry,
  ): Promise<void> {
    if (!callback) return;
    try {
      await callback(entry);
    } catch (error) {
      this.logger.warn(`Failed to persist LLM trace: ${String(error)}`);
    }
  }

  private parseJson<T>(content: string): T {
    const trimmed = content.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]) as T;
      }
      throw new Error('Failed to parse LLM JSON');
    }
  }
}
