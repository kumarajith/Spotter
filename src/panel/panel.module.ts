import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { PanelRepository } from './panel.repository';
import { PanelService } from './panel.service';

@Module({
  imports: [ActivityModule],
  providers: [PanelRepository, PanelService],
  exports: [PanelService, PanelRepository],
})
export class PanelModule {}
