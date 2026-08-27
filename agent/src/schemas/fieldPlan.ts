import { z } from 'zod'

export const widgetTypeSchema = z.enum([
  'input',
  'textarea',
  'radio',
  'select',
  'number',
  'date',
  'static-text',
  'divider',
])

export const fieldOptionSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string().min(1),
})

export const fieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  type: widgetTypeSchema,
  required: z.boolean().optional(),
  options: z.array(fieldOptionSchema).optional(),
  textContent: z.string().optional(),
})

export const fieldPlanSchema = z.object({
  formTitle: z.string().min(1).max(200),
  layout: z.enum(['single-column', 'sectioned']).default('sectioned'),
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        fields: z.array(fieldSchema).min(1).max(80),
      }),
    )
    .min(1)
    .max(30),
})

export const generateResponseSchema = z.object({
  summary: z.string(),
  warnings: z.array(z.string()),
  formJson: z.object({
    widgetList: z.array(z.any()),
    formConfig: z.record(z.any()),
  }),
})

export type FieldPlan = z.infer<typeof fieldPlanSchema>
export type FieldType = z.infer<typeof widgetTypeSchema>
export type GenerateResponse = z.infer<typeof generateResponseSchema>

export const excelDigestSchema = z.object({
  title: z.string().optional(),
  sections: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          label: z.string(),
          optionText: z.string().optional(),
          sampleScore: z.string().optional(),
        }),
      ),
    }),
  ),
  notes: z.array(z.string()),
})

export type ExcelDigest = z.infer<typeof excelDigestSchema>
