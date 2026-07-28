import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AiBudgetService } from './budget/ai-budget.service';
import { AiConsentService } from './budget/ai-consent.service';
import { AiConsentGuard } from './budget/ai-consent.guard';
import { PromptBuilder } from './prompt/prompt-builder';
import { AnthropicLlmProvider } from './providers/anthropic.provider';
import { OpenAiLlmProvider } from './providers/openai.provider';
import { LlmRouter } from './providers/llm-router';
import { AiInvocationRecorder } from './recorder/ai-invocation.recorder';

/**
 * Root module for the AI feature. `AiMetricsCollector` lives in
 * `MetricsModule` (which is `@Global`) so the AI collector is scraped
 * alongside every other subsystem on the same `/metrics` endpoint;
 * `AiInvocationRecorder` picks it up via DI from the global container.
 *
 * Task 5.0 will layer the `AiController` and the four use-case services on
 * top of the port + guardrail providers exposed here.
 */
@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [
    AnthropicLlmProvider,
    OpenAiLlmProvider,
    LlmRouter,
    PromptBuilder,
    AiBudgetService,
    AiConsentService,
    AiConsentGuard,
    AiInvocationRecorder,
  ],
  exports: [
    LlmRouter,
    PromptBuilder,
    AiBudgetService,
    AiConsentService,
    AiConsentGuard,
    AiInvocationRecorder,
  ],
})
export class AiModule {}
