import { createHash } from 'node:crypto'
import { z } from 'zod'
import { constraintSourceSchema, linkageBlockedWhenSchema, valueKindSchema } from './widgetCatalog.js'

export const designTruthEditorEntrySchema = z.object({
  relPath: z.string().min(1),
  valueKind: valueKindSchema,
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  linkageHiddenWhen: linkageBlockedWhenSchema.optional(),
  source: constraintSourceSchema.default('property-editor'),
})

export const designTruthTypeOverrideSchema = z.object({
  widgetType: z.string().min(1),
  prop: z.string().min(1),
  editor: z.string().min(1),
  /** alert-type 等：存在 type 覆盖时跳过通用 type-editor */
  skipsGenericEditor: z.boolean().optional(),
})

export const designTruthGraphSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    propertyEditorRoot: z.string().min(1),
    editorFileCount: z.number().int().positive(),
    registerEditorCount: z.number().int().nonnegative(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  generatedAt: z.literal('source-derived'),
  editors: z.record(designTruthEditorEntrySchema),
  typeOverrides: z.array(designTruthTypeOverrideSchema),
})

export type DesignTruthEditorEntry = z.infer<typeof designTruthEditorEntrySchema>
export type DesignTruthTypeOverride = z.infer<typeof designTruthTypeOverrideSchema>
export type DesignTruthGraph = z.infer<typeof designTruthGraphSchema>

export function parseDesignTruthGraph(input: unknown): DesignTruthGraph {
  return designTruthGraphSchema.parse(input)
}

export function calculateDesignTruthFingerprint(
  editorSources: Array<{ relPath: string; content: string }>,
  registerSource: string,
): string {
  const hash = createHash('sha256')
  for (const file of [...editorSources].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    hash.update(`\n---EDITOR:${file.relPath}---\n`)
    hash.update(file.content.replace(/\r\n/g, '\n'))
  }
  hash.update('\n---PROPERTY_REGISTER---\n')
  hash.update(registerSource.replace(/\r\n/g, '\n'))
  return hash.digest('hex')
}

export function diffDesignTruthGraph(expected: DesignTruthGraph, actual: DesignTruthGraph): string[] {
  const diffs: string[] = []
  if (expected.source.fingerprint !== actual.source.fingerprint) {
    diffs.push(
      `design-truth fingerprint mismatch: expected ${expected.source.fingerprint} actual ${actual.source.fingerprint}`,
    )
  }
  if (expected.source.editorFileCount !== actual.source.editorFileCount) {
    diffs.push(
      `editor file count mismatch: expected ${expected.source.editorFileCount} actual ${actual.source.editorFileCount}`,
    )
  }
  const expectedNames = new Set(Object.keys(expected.editors))
  const actualNames = new Set(Object.keys(actual.editors))
  for (const name of expectedNames) {
    if (!actualNames.has(name)) diffs.push(`missing editor entry: ${name}`)
  }
  for (const name of actualNames) {
    if (!expectedNames.has(name)) diffs.push(`unexpected editor entry: ${name}`)
  }
  for (const [name, editor] of Object.entries(expected.editors)) {
    const other = actual.editors[name]
    if (!other) continue
    if (editor.valueKind !== other.valueKind) {
      diffs.push(`${name} valueKind mismatch: expected ${editor.valueKind} actual ${other.valueKind}`)
    }
  }
  return diffs
}
