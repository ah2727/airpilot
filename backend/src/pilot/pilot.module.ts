import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FdrRecord } from './fdr-record.entity';
import { PilotRepository } from './pilot.repository';
import { PilotService } from './pilot.service';
import { PilotGateway } from './pilot.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([FdrRecord])],
  providers: [PilotRepository, PilotService, PilotGateway],
})
export class PilotModule {}
