import { z } from 'zod';

// CreateOrganization / UpdateOrganization: DTO とパリティ
// （mcp-schema-parity.spec で担保。Update は id を extraZodKeys で吸収）。
export const CreateOrganizationSchema = z.object({
  code: z.string().max(32).optional(),
  name: z.string().min(1).max(200),
  parentId: z.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  note: z.string().max(500).optional(),
});

export const UpdateOrganizationSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().max(32).optional(),
  name: z.string().max(200).optional(),
  parentId: z.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  note: z.string().max(500).optional(),
});
