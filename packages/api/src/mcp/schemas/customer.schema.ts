import { z } from 'zod';

export const CreateCustomerSchema = z.object({
  code: z.string().max(32).optional(),
  name: z.string().min(1).max(150),
  contactName: z.string().max(100).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactPhone: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  isActive: z.boolean().optional(),
  note: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
  organizationId: z.number().int().nullable().optional(),
});

export const UpdateCustomerSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().max(32).optional(),
  name: z.string().max(150).optional(),
  contactName: z.string().max(100).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactPhone: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  isActive: z.boolean().optional(),
  note: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
  organizationId: z.number().int().nullable().optional(),
});
