import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { UserProjectViewPreferencesController } from './user-project-view-preferences.controller';
import { UserProjectViewPreferencesService } from './user-project-view-preferences.service';

@Module({
  imports: [PrismaModule, ProjectsModule],
  controllers: [UserProjectViewPreferencesController],
  providers: [UserProjectViewPreferencesService],
  exports: [UserProjectViewPreferencesService],
})
export class UserProjectViewPreferencesModule {}
