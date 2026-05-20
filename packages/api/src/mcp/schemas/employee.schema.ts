import { z } from 'zod';
import { YyyyMmDd } from './common.schema';

export const CreateEmployeeSchema = z.object({
  code: z.string().max(32).optional(),
  name: z.string().min(1).max(100),
  nameKana: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  role: z.string().max(100).optional(),
  email: z.string().email().max(200).optional(),
  employmentStart: YyyyMmDd.optional(),
  employmentEnd: YyyyMmDd.optional(),
  worksOnHolidays: z.boolean().optional(),
  isActive: z.boolean().optional(),
  note: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
  organizationId: z.number().int().nullable().optional(),
});

export const UpdateEmployeeSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().max(32).optional(),
  name: z.string().max(100).optional(),
  nameKana: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  role: z.string().max(100).optional(),
  email: z.string().email().max(200).optional(),
  employmentStart: YyyyMmDd.nullable().optional(),
  employmentEnd: YyyyMmDd.nullable().optional(),
  worksOnHolidays: z.boolean().optional(),
  isActive: z.boolean().optional(),
  note: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
  organizationId: z.number().int().nullable().optional(),
});

export const ListAssignmentsSchema = z.object({
  employeeId: z.number().int().positive(),
  from: YyyyMmDd.optional(),
  to: YyyyMmDd.optional(),
});
