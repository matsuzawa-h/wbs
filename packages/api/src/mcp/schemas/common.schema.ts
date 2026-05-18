import { z } from 'zod';

export const YyyyMmDd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const IdParam = z.object({
  id: z.number().int().positive(),
});

export const ProjectIdParam = z.object({
  projectId: z.number().int().positive(),
});

export const EmployeeIdParam = z.object({
  employeeId: z.number().int().positive(),
});
