import type { FastifyInstance } from 'fastify'
import { interactionRequestSchema } from '../schemas/interactionOutput.js'
import { generateInteraction } from '../services/interactionGenerator.js'
import { planInteractionApply } from '../services/interactionApply.js'
import { buildInteractionCandidate } from '../services/interactionApply.js'
import { repairInteraction, MAX_REPAIR_ROUNDS } from '../services/interactionRepair.js'
import { scenarioFingerprint } from '../services/interactionMerger.js'
import { narrateScenarios } from '../services/scenarioNarrator.js'

export async function registerInteractionRoutes(app: FastifyInstance) {
  app.post('/api/agent/v1/interaction', async (request, reply) => {
    try {
      const parsed = interactionRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          message: '请求参数无效',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        })
      }

      const data = parsed.data

      if (data.action === 'generate') {
        if (!Array.isArray(data.currentFormJson.widgetList) || data.currentFormJson.widgetList.length === 0) {
          return reply.code(400).send({ message: '当前表单为空，请先生成或拖拽控件后再描述交互' })
        }
        const result = await generateInteraction({
          instruction: data.instruction,
          currentFormJson: data.currentFormJson,
          messages: data.messages,
        })
        if (result.status === 'error' && result.error?.includes('DEEPSEEK_API_KEY')) {
          return reply.code(503).send({
            status: 'error',
            summary: result.error,
            applied: false,
            formJson: data.currentFormJson,
            output: result.output,
          })
        }
        return reply.code(200).send({
          status: result.status,
          summary: result.output.summary || result.error || '',
          warnings: result.mergeWarnings || [],
          applied: false,
          formJson: data.currentFormJson,
          formJsonCandidate: result.formJsonCandidate,
          output: result.output,
          scenarioNarration: result.scenarioNarration || narrateScenarios(result.output.scenarios),
          scenarioFingerprint: result.scenarioFingerprint,
          usedMock: result.usedMock,
          rewriteCount: result.rewriteCount,
          issues: result.issues,
          error: result.error,
          questions: result.output.questions,
          unsupported: result.output.unsupported,
        })
      }

      if (data.action === 'repair') {
        if (data.round > MAX_REPAIR_ROUNDS) {
          return reply.code(200).send({
            status: 'failed',
            summary: `修正轮次已用尽（最多 ${MAX_REPAIR_ROUNDS}）`,
            applied: false,
            formJson: data.currentFormJson,
            output: data.output,
            round: data.round,
          })
        }
        const expected =
          data.expectedScenarioFingerprint || scenarioFingerprint(data.output.scenarios)
        const result = await repairInteraction({
          instruction: data.instruction,
          currentFormJson: data.currentFormJson,
          previous: data.output,
          verificationReport: data.verificationReport,
          round: data.round,
        })
        if (!result.ok && result.status === 'tamper') {
          return reply.code(422).send({
            status: 'tamper',
            summary: result.error,
            applied: false,
            formJson: data.currentFormJson,
            output: data.output,
            round: data.round,
            expectedScenarioFingerprint: expected,
          })
        }
        if (!result.ok) {
          const code = result.status === 'error' && result.error.includes('DEEPSEEK') ? 503 : 200
          return reply.code(code).send({
            status: result.status,
            summary: result.error,
            applied: false,
            formJson: data.currentFormJson,
            output: result.output,
            round: data.round,
          })
        }
        const preview = buildInteractionCandidate(data.currentFormJson, result.output)
        return reply.code(200).send({
          status: 'generated',
          summary: result.output.summary,
          applied: false,
          formJson: data.currentFormJson,
          formJsonCandidate: preview.ok ? preview.formJsonCandidate : undefined,
          output: result.output,
          scenarioNarration: narrateScenarios(result.output.scenarios),
          scenarioFingerprint: scenarioFingerprint(result.output.scenarios),
          round: result.round,
          usedMock: result.usedMock,
          mergeError: preview.ok ? undefined : preview.error,
        })
      }

      // apply
      const { response, httpStatus } = planInteractionApply({
        currentFormJson: data.currentFormJson,
        output: data.output,
        verificationReport: data.verificationReport,
        userConfirmed: data.userConfirmed,
        confirmOverwrite: data.confirmOverwrite,
      })
      return reply.code(httpStatus).send(response)
    } catch (err) {
      request.log.error(err)
      return reply.code(500).send({
        message: err instanceof Error ? err.message : '交互接口失败',
      })
    }
  })
}
