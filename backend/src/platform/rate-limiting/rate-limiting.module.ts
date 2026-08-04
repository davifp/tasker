import { Module } from '@nestjs/common';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import { RateLimitMetricsCollector } from './rate-limit.metrics';
import { TokenBucketService } from './token-bucket.service';

@Module({
  providers: [TokenBucketService, RateLimitMetricsCollector, RateLimitInterceptor],
  exports: [TokenBucketService, RateLimitMetricsCollector, RateLimitInterceptor],
})
export class RateLimitingModule {}
