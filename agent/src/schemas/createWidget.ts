import { z } from 'zod'
import { normalizeTargetRef } from '../services/parentScopeParser.js'

/** 同事务临时引用：仅候选编译期内有效，合入前解析为真实 id/name */
export const tempRefSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_:-]*$/, 'tempRef must be a stable identifier')

const existingRefObjectSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    containerType: z.string().min(1).optional(),
    pathPrefix: z.string().min(1).optional(),
  })
  .refine((t) => Boolean(t.id || t.name || t.label || t.pathPrefix), {
    message: 'target requires id, name, label, or pathPrefix',
  })

export const createExistingRefSchema = z.preprocess((val) => normalizeTargetRef(val), existingRefObjectSchema)

export const createSiblingRefSchema = z.union([
  z.object({ tempRef: tempRefSchema }),
  createExistingRefSchema,
])

export const createPositionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first') }),
  z.object({ kind: z.literal('last') }),
  z.object({
    kind: z.literal('before'),
    sibling: createSiblingRefSchema,
  }),
  z.object({
    kind: z.literal('after'),
    sibling: createSiblingRefSchema,
  }),
])

export const createParentRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('root') }),
  z.object({ kind: z.literal('tempRef'), tempRef: tempRefSchema }),
  z.object({
    kind: z.literal('existing'),
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    containerType: z.string().min(1).optional(),
    pathPrefix: z.string().min(1).optional(),
  }),
])

export type CreateParentRef = z.infer<typeof createParentRefSchema>
export type CreatePosition = z.infer<typeof createPositionSchema>
export type TempRef = z.infer<typeof tempRefSchema>

function assertExistingParent(parent: Extract<CreateParentRef, { kind: 'existing' }>): void {
  if (!(parent.id || parent.name || parent.label || parent.pathPrefix)) {
    throw new Error('existing parent requires id, name, label, or pathPrefix')
  }
}

/** 将省略 kind / 纯 TargetRef / 字符串归一为 CreateParentRef */
export function normalizeCreateParent(val: unknown): CreateParentRef {
  if (val == null) return { kind: 'root' }
  if (typeof val === 'string') {
    const normalized = normalizeTargetRef(val)
    if (normalized && typeof normalized === 'object') {
      const parent = createParentRefSchema.parse({ kind: 'existing', ...normalized })
      if (parent.kind === 'existing') assertExistingParent(parent)
      return parent
    }
  }
  if (typeof val === 'object' && val) {
    const raw = 'kind' in (val as object) ? val : { kind: 'existing', ...(val as object) }
    const parent = createParentRefSchema.parse(raw)
    if (parent.kind === 'existing') assertExistingParent(parent)
    return parent
  }
  return createParentRefSchema.parse(val)
}

/**
 * 统一创建操作（Catalog 驱动）。
 * 须保持 ZodObject（供 refinePlan discriminatedUnion 使用）；
 * parent 在编译器内 normalizeCreateParent。
 */
export const createWidgetOpSchema = z.object({
  op: z.literal('createWidget'),
  type: z.string().min(1).max(64),
  tempRef: tempRefSchema.optional(),
  parent: z.unknown().optional(),
  position: createPositionSchema.optional(),
  label: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(64).optional(),
  optionOverrides: z.record(z.unknown()).optional(),
})

export type CreateWidgetOp = z.infer<typeof createWidgetOpSchema>

/** 无 op 字段的创建规格（generate/内部编译用） */
export const createWidgetSpecSchema = createWidgetOpSchema.omit({ op: true })
export type CreateWidgetSpec = z.infer<typeof createWidgetSpecSchema>
