import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';

import { FdrRecord } from './fdr-record.entity';
import { PilotRepository } from './pilot.repository'; // keep if other parts use it
import { PilotService } from './pilot.service';
import { PilotGateway } from './pilot.gateway';
import { PilotController } from './pilot.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([FdrRecord]), // <-- correct entity/table
    CacheModule.register({ ttl: 30, max: 1000 }),
  ],
  controllers: [PilotController],
  providers: [PilotRepository, PilotService, PilotGateway],
})
export class PilotModule {}
