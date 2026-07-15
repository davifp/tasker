import { Global, Module } from '@nestjs/common';
import { WorkspaceContextStore } from './workspace-context.store';

@Global()
@Module({
  providers: [WorkspaceContextStore],
  exports: [WorkspaceContextStore],
})
export class ContextModule {}
