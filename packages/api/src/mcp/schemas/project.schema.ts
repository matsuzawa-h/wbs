import { z } from 'zod';

const projectStatus = z.enum([
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  customerId: z.number().int().nullable().optional(),
  organizationId: z.number().int().nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  status: projectStatus.optional(),
});

export const UpdateProjectSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().max(200).optional(),
  customerId: z.number().int().nullable().optional(),
  organizationId: z.number().int().nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  status: projectStatus.optional(),
});

export const SetMembersSchema = z.object({
  projectId: z.number().int().positive(),
  employeeIds: z.array(z.number().int().positive()).max(500),
});
