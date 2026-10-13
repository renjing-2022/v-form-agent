import { z } from 'zod'

/** 失败分类（FR-2）；与修正路由一一对应 */
export const failureClassSchema = z.enum([
  'code',
  'structure',
  'intent',
  'policy',
  'infrastructure',
])

export const repairRouteSchema = z.enum([
  'repair_code',
  'replan',
  'clarify',
  'reject',
  'blocked',
])

export const criticFindingSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(2000),
  path: z.string().max(256).optional(),
})

/** Plan Critic：不得把 generator 的「通过」结论当作输入 */
export const planCriticInputSchema = z.object({
  /** 原始意图摘要（用户指令截断），非 generator summary */
  intentSummary: z.string().max(2000),
  formFingerprint: z.string().min(1).max(128),
  /** 画布已知目标（name/id），不含模型自评 */
  knownTargets: z.array(z.string()).max(500),
  structureOps: z
    .array(
      z.object({
        op: z.string(),
        type: z.string().optional(),
        name: z.string().optional(),
        tempRef: z.string().optional(),
        parent: z.string().optional(),
      }),
    )
    .max(80),
  handlerTargets: z
    .array(
      z.object({
        target: z.string(),
        eventKey: z.string(),
      }),
    )
    .max(80),
  staticIssues: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .max(80)
    .default([]),
})

export const planCriticVerdictSchema = z.object({
  critic: z.literal('plan'),
  pass: z.boolean(),
  route: repairRouteSchema,
  findings: z.array(criticFindingSchema).max(40),
  fingerprint: z.string().min(1).max(128),
})

/** Scenario Critic：审阅场景结构/引用；不以 generator assert 为 ground truth */
export const scenarioCriticInputSchema = z.object({
  intentSummary: z.string().max(2000),
  formFingerprint: z.string().min(1).max(128),
  knownTargets: z.array(z.string()).max(500),
  handlerIds: z.array(z.string()).max(80),
  scenarios: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        handlerRefs: z.array(z.string()).default([]),
        actCount: z.number().int().nonnegative(),
        assertCount: z.number().int().nonnegative(),
        referencedFields: z.array(z.string()).max(40),
      }),
    )
    .max(40),
})

export const scenarioCriticVerdictSchema = z.object({
  critic: z.literal('scenario'),
  pass: z.boolean(),
  route: repairRouteSchema,
  findings: z.array(criticFindingSchema).max(40),
  fingerprint: z.string().min(1).max(128),
})

export const failureClassificationSchema = z.object({
  class: failureClassSchema,
  route: repairRouteSchema,
  reasons: z.array(z.string()).max(20),
  consumeBusinessBudget: z.boolean(),
  failureFingerprint: z.string().min(1).max(128),
})

export const repairDecisionSchema = z.object({
  class: failureClassSchema,
  route: repairRouteSchema,
  reasons: z.array(z.string()).max(20),
  consumeBusinessBudget: z.boolean(),
  candidateFingerprint: z.string().min(1).max(128),
  failureFingerprint: z.string().min(1).max(128),
  attemptFingerprint: z.string().min(1).max(128),
  duplicate: z.boolean(),
  budgetExhausted: z.boolean(),
  ledger: z.object({
    codeAttempts: z.number().int().nonnegative(),
    replanAttempts: z.number().int().nonnegative(),
    totalAttempts: z.number().int().nonnegative(),
    seenAttemptFingerprints: z.array(z.string()).max(40),
  }),
})

export const attemptBudgetSchema = z.object({
  maxCodeRepair: z.number().int().positive(),
  maxReplan: z.number().int().positive(),
  maxTotal: z.number().int().positive(),
})

export type FailureClass = z.infer<typeof failureClassSchema>
export type RepairRoute = z.infer<typeof repairRouteSchema>
export type CriticFinding = z.infer<typeof criticFindingSchema>
export type PlanCriticInput = z.infer<typeof planCriticInputSchema>
export type PlanCriticVerdict = z.infer<typeof planCriticVerdictSchema>
export type ScenarioCriticInput = z.infer<typeof scenarioCriticInputSchema>
export type ScenarioCriticVerdict = z.infer<typeof scenarioCriticVerdictSchema>
export type FailureClassification = z.infer<typeof failureClassificationSchema>
export type RepairDecision = z.infer<typeof repairDecisionSchema>
export type AttemptBudget = z.infer<typeof attemptBudgetSchema>
