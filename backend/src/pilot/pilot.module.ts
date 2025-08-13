import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FdrRecord } from "./fdr-record.entity";
import { PilotRepository } from "./pilot.repository";
import { PilotService } from "./pilot.service";
import { PilotGateway } from "./pilot.gateway";
import { PilotController } from "./pilot.controller";
@Module({
  imports: [TypeOrmModule.forFeature([FdrRecord])],
  providers: [PilotRepository, PilotService, PilotGateway],
  controllers: [PilotController],
})
export class PilotModule {}
