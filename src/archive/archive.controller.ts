import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { Query } from '@nestjs/common';
import { Request } from 'express';
import { Response } from 'express';
import { SessionAuthGuard } from '../auth/session.guard';

@Controller('archive')
export class ArchiveController {
  constructor(private readonly archiveService: ArchiveService) {}

  @UseGuards(SessionAuthGuard)
  @Get('all')
  async getAll(
    @Query('offset') offset = '0',
    @Query('limit') limit = '10',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.archiveService.findAll({
      offset: parseInt(offset, 10),
      limit: parseInt(limit, 10),
      req,
    });
    if (req.accepts('html')) {
      res.render('pagination', result);
    } else {
      res.json(result);
    }
  }

  @Get(':txId')
  async getOne(@Param('txId') txId: string): Promise<any> {
    const raw = await this.archiveService.getDataByTX(txId);
    return JSON.parse(raw);
  }
}
