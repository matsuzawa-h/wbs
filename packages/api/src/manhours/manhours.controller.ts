import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ManualEntryDto } from './dto/manual-entry.dto';
import { ManualProjectDto } from './dto/manual-project.dto';
import { ManhoursService, SourceFilter } from './manhours.service';
import { parseOrgQuery } from '../customers/customers.controller';

function toInt(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

// 既定は両方 true。`?imported=false` のように明示時のみ無効化。
function sourceFilter(imported?: string, manual?: string): SourceFilter {
  return {
    imported: imported !== 'false',
    manual: manual !== 'false',
  };
}

@Controller('manhours')
export class ManhoursController {
  constructor(private readonly manhours: ManhoursService) {}

  @Get('batches')
  listBatches(
    @Query('fiscalYear') fiscalYear?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.manhours.listBatches(
      toInt(fiscalYear),
      parseOrgQuery(organizationId),
    );
  }

  @Get('summary')
  summary(
    @Query('fiscalYear') fiscalYear?: string,
    @Query('batchId') batchId?: string,
    @Query('imported') imported?: string,
    @Query('manual') manual?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.manhours.getSummary({
      fiscalYear: toInt(fiscalYear),
      batchId: toInt(batchId),
      filter: sourceFilter(imported, manual),
      organizationId: parseOrgQuery(organizationId),
    });
  }

  @Get('projects/:projectId/matrix')
  projectMatrix(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('batchId') batchId?: string,
    @Query('imported') imported?: string,
    @Query('manual') manual?: string,
  ) {
    return this.manhours.getProjectMatrix(projectId, {
      fiscalYear: toInt(fiscalYear),
      batchId: toInt(batchId),
      filter: sourceFilter(imported, manual),
    });
  }

  @Get('assignees/:assigneeId/detail')
  assigneeDetail(
    @Param('assigneeId', ParseIntPipe) assigneeId: number,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('batchId') batchId?: string,
    @Query('imported') imported?: string,
    @Query('manual') manual?: string,
  ) {
    return this.manhours.getAssigneeDetail(assigneeId, {
      fiscalYear: toInt(fiscalYear),
      batchId: toInt(batchId),
      filter: sourceFilter(imported, manual),
    });
  }

  @Post('manual-entries')
  upsertManualEntry(@Body() dto: ManualEntryDto) {
    return this.manhours.upsertManualEntry(dto);
  }

  @Delete('manual-entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteManualEntry(@Param('id', ParseIntPipe) id: number): void {
    this.manhours.deleteManualEntry(id);
  }

  @Post('manual-projects')
  createManualProject(@Body() dto: ManualProjectDto) {
    return this.manhours.createManualProject(dto);
  }

  @Delete('batches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBatch(@Param('id', ParseIntPipe) id: number): void {
    this.manhours.deleteBatch(id);
  }
}
