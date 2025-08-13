// src/pilot/pilot.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { PilotService } from './pilot.service';

@Controller('pilot')
export class PilotController {
  constructor(private readonly pilot: PilotService) {}

  @Get('path')
  async path(
    @Query('flightNumber') flightNumber: string,
    @Query('date') date: string,
  ) {
    const path = await this.pilot.getPath({ flightNumber, date: Number(date) });
    return { path };
  }
}
