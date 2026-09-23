import type { FastifyInstance } from 'fastify'
import { eventRequestSchema } from '../schemas/eventSpec.js'
import { planEventClarify, assertEventKeysUnchanged } from '../services/eventPlanner.js'
import { planEventGenerate, planEventApply } from '../services/eventApply.js'

export async function registerEventRoutes(app: FastifyInstance) {
  app.post('/api/agent/v1/event', async (request, reply) => {
    try {
      const parsed = eventRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          message: '请求参数无效',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        })
      }

      const data = parsed.data
      if (!Array.isArray(data.currentFormJson.widgetList) || data.currentFormJson.widgetList.length === 0) {
        return reply.code(400).send({
          message: '当前表单为空，请先生成或拖拽控件后再描述交互',
        })
      }

      if (data.action === 'generate') {
        if (!data.eventSpec) {
          return reply.code(400).send({ message: 'generate 需要 eventSpec' })
        }
        const { response, httpStatus } = planEventGenerate({
          instruction: data.instruction,
          currentFormJson: data.currentFormJson,
          eventSpec: data.eventSpec,
        })
        if (response.status === 'code_preview') {
          assertEventKeysUnchanged(data.currentFormJson, response.formJson)
          if (response.applied) {
            return reply.code(500).send({ message: 'code_preview must keep applied=false' })
          }
        }
        return reply.code(httpStatus).send(response)
      }

      if (data.action === 'apply') {
        if (!data.eventSpec) {
          return reply.code(400).send({ message: 'apply 需要 eventSpec' })
        }
        const { response, httpStatus } = planEventApply({
          instruction: data.instruction,
          currentFormJson: data.currentFormJson,
          eventSpec: data.eventSpec,
          patches: data.patches as any,
          executionReport: data.executionReport,
          confirmOverwrite: data.confirmOverwrite,
        })
        if (response.status === 'applied') {
          if (response.applied !== true) {
            return reply.code(500).send({ message: 'applied status requires applied=true' })
          }
          if (!/已写入|已应用/.test(response.summary)) {
            /* summary already claims write */
          }
        } else if (response.applied) {
          return reply.code(500).send({ message: 'non-applied status must keep applied=false' })
        }
        return reply.code(httpStatus).send(response)
      }

      const { response, httpStatus } = planEventClarify({
        instruction: data.instruction,
        currentFormJson: data.currentFormJson,
        messages: data.messages,
      })

      assertEventKeysUnchanged(data.currentFormJson, response.formJson)

      if (response.applied !== false) {
        return reply.code(500).send({ message: 'clarify must never set applied=true' })
      }
      if (/已更新事件|已应用\s*JS|已写入事件/i.test(response.summary)) {
        return reply.code(500).send({ message: 'summary must not claim event write' })
      }

      return reply.code(httpStatus).send(response)
    } catch (err) {
      request.log.error(err)
      return reply.code(500).send({
        message: err instanceof Error ? err.message : '事件接口失败',
      })
    }
  })
}
