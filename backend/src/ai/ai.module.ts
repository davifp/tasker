import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AiController } from './ai.controller';
import { AiBudgetService } from './budget/ai-budget.service';
import { AiConsentService } from './budget/ai-consent.service';
import { AiConsentGuard } from './budget/ai-consent.guard';
import { AiFeedbackService } from './feedback/ai-feedback.service';
import { PromptBuilder } from './prompt/prompt-builder';
import { AnthropicLlmProvider } from './providers/anthropic.provider';
import { OpenAiLlmProvider } from './providers/openai.provider';
import { LlmRouter } from './providers/llm-router';
import { AiInvocationRecorder } from './recorder/ai-invocation.recorder';
import { EstimateAndSuggestService } from './use-cases/estimate-and-suggest.service';
import { GenerateChecklistService } from './use-cases/generate-checklist.service';
import { GenerateDescriptionService } from './use-cases/generate-description.service';
import { SummarizeCommentsService } from './use-cases/summarize-comments.service';

/**
 * Root module for the AI feature. `AiMetricsCollector` lives in
 * `MetricsModule` (which is `@Global`) so the AI collector is scraped
 * alongside every other subsystem on the same `/metrics` endpoint;
 * `AiInvocationRecorder` picks it up via DI from the global container.
 *
 * Hosts the seven-route `AiController` (consent, usage, feedback, and the
 * four use-cases) plus the guardrails (`AiConsentGuard`, `AiBudgetService`)
 * and the provider abstraction (router, adapters, prompt builder).
 */
@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AiController],
  providers: [
    AnthropicLlmProvider,
    OpenAiLlmProvider,
    LlmRouter,
    PromptBuilder,
    AiBudgetService,
    AiConsentService,
    AiConsentGuard,
    AiFeedbackService,
    AiInvocationRecorder,
    GenerateDescriptionService,
    SummarizeCommentsService,
    GenerateChecklistService,
    EstimateAndSuggestService,
  ],
  exports: [
    LlmRouter,
    PromptBuilder,
    AiBudgetService,
    AiConsentService,
    AiConsentGuard,
    AiFeedbackService,
    AiInvocationRecorder,
    GenerateDescriptionService,
    SummarizeCommentsService,
    GenerateChecklistService,
    EstimateAndSuggestService,
  ],
})
export class AiModule {}
