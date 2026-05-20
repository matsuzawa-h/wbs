import 'reflect-metadata';
import { getMetadataStorage } from 'class-validator';
import type { ZodObject, ZodRawShape } from 'zod';

import { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { UpdateCustomerDto } from '../customers/dto/update-customer.dto';
import { CreateOrganizationDto } from '../organizations/dto/create-organization.dto';
import { UpdateOrganizationDto } from '../organizations/dto/update-organization.dto';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { SetMembersDto } from '../projects/dto/set-members.dto';
import { CreateTaskDto } from '../tasks/dto/create-task.dto';
import { UpdateTaskDto } from '../tasks/dto/update-task.dto';
import { ReorderTasksDto } from '../tasks/dto/reorder-tasks.dto';
import { CreatePersonalTaskDto } from '../personal-tasks/dto/create-personal-task.dto';
import { UpdatePersonalTaskDto } from '../personal-tasks/dto/update-personal-task.dto';
import { CreateEmployeeDto } from '../employees/dto/create-employee.dto';
import { UpdateEmployeeDto } from '../employees/dto/update-employee.dto';
import { ListAssignmentsDto } from '../employees/dto/list-assignments.dto';
import { CreateHolidayDto } from '../holidays/dto/create-holiday.dto';
import { UpdateHolidayDto } from '../holidays/dto/update-holiday.dto';
import { BulkHolidaysDto } from '../holidays/dto/bulk-holidays.dto';
import { ManualEntryDto } from '../manhours/dto/manual-entry.dto';
import { ManualProjectDto } from '../manhours/dto/manual-project.dto';

import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from './schemas/customer.schema';
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
} from './schemas/organization.schema';
import {
  CreateProjectSchema,
  SetMembersSchema,
  UpdateProjectSchema,
} from './schemas/project.schema';
import {
  CreateTaskSchema,
  ReorderTasksSchema,
  UpdateTaskSchema,
} from './schemas/task.schema';
import {
  CreatePersonalTaskSchema,
  UpdatePersonalTaskSchema,
} from './schemas/personal-task.schema';
import {
  CreateEmployeeSchema,
  ListAssignmentsSchema,
  UpdateEmployeeSchema,
} from './schemas/employee.schema';
import {
  BulkHolidaysSchema,
  CreateHolidaySchema,
  UpdateHolidaySchema,
} from './schemas/holiday.schema';
import {
  ManualEntrySchema,
  ManualProjectSchema,
} from './schemas/manhour.schema';

type DtoCtor = new (...args: never[]) => unknown;

function dtoFieldNames(dtoClass: DtoCtor): Set<string> {
  const storage = getMetadataStorage();
  const metas = storage.getTargetValidationMetadatas(dtoClass, '', true, true);
  return new Set(metas.map((m) => m.propertyName));
}

function zodKeys(schema: ZodObject<ZodRawShape>): Set<string> {
  return new Set(Object.keys(schema.shape));
}

function assertParity(
  label: string,
  zodSchema: ZodObject<ZodRawShape>,
  dtoClass: DtoCtor,
  extraZodKeys: string[] = [],
): void {
  const zKeys = zodKeys(zodSchema);
  const dKeys = dtoFieldNames(dtoClass);
  for (const extra of extraZodKeys) dKeys.add(extra);

  const onlyInZod = [...zKeys].filter((k) => !dKeys.has(k)).sort();
  const onlyInDto = [...dKeys].filter((k) => !zKeys.has(k)).sort();
  if (onlyInZod.length || onlyInDto.length) {
    throw new Error(
      `Schema parity mismatch [${label}]: ` +
        `only-in-zod=[${onlyInZod.join(',')}] ` +
        `only-in-dto=[${onlyInDto.join(',')}]`,
    );
  }
}

describe('MCP Zod / class-validator DTO parity', () => {
  it('customers', () => {
    assertParity('CreateCustomer', CreateCustomerSchema, CreateCustomerDto);
    assertParity('UpdateCustomer', UpdateCustomerSchema, UpdateCustomerDto, ['id']);
  });

  it('organizations', () => {
    assertParity(
      'CreateOrganization',
      CreateOrganizationSchema,
      CreateOrganizationDto,
    );
    assertParity(
      'UpdateOrganization',
      UpdateOrganizationSchema,
      UpdateOrganizationDto,
      ['id'],
    );
  });

  it('projects', () => {
    assertParity('CreateProject', CreateProjectSchema, CreateProjectDto);
    assertParity('UpdateProject', UpdateProjectSchema, UpdateProjectDto, ['id']);
    assertParity('SetMembers', SetMembersSchema, SetMembersDto, ['projectId']);
  });

  it('tasks', () => {
    assertParity('CreateTask', CreateTaskSchema, CreateTaskDto, ['projectId']);
    assertParity('UpdateTask', UpdateTaskSchema, UpdateTaskDto, ['id']);
    assertParity('ReorderTasks', ReorderTasksSchema, ReorderTasksDto);
  });

  it('personal-tasks', () => {
    assertParity(
      'CreatePersonalTask',
      CreatePersonalTaskSchema,
      CreatePersonalTaskDto,
      ['employeeId'],
    );
    assertParity(
      'UpdatePersonalTask',
      UpdatePersonalTaskSchema,
      UpdatePersonalTaskDto,
      ['id'],
    );
  });

  it('employees', () => {
    assertParity('CreateEmployee', CreateEmployeeSchema, CreateEmployeeDto);
    assertParity('UpdateEmployee', UpdateEmployeeSchema, UpdateEmployeeDto, ['id']);
    assertParity('ListAssignments', ListAssignmentsSchema, ListAssignmentsDto, [
      'employeeId',
    ]);
  });

  it('holidays', () => {
    assertParity('CreateHoliday', CreateHolidaySchema, CreateHolidayDto);
    assertParity('UpdateHoliday', UpdateHolidaySchema, UpdateHolidayDto, ['id']);
    assertParity('BulkHolidays', BulkHolidaysSchema, BulkHolidaysDto);
  });

  it('manhours', () => {
    assertParity('ManualEntry', ManualEntrySchema, ManualEntryDto);
    assertParity('ManualProject', ManualProjectSchema, ManualProjectDto);
  });
});
