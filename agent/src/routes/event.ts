import type { FastifyInstance } from 'fastify'
import { eventRequestSchema } from '../schemas/eventSpec.js'
import { planEventClarify, assertEventKeysUnchanged } from '../services/eventPlanner.js'

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

      const { instruction, currentFormJson, messages } = parsed.data
      if (!Array.isArray(currentFormJson.widgetList) || currentFormJson.widgetList.length === 0) {
        return reply.code(400).send({
          message: '当前表单为空，请先生成或拖拽控件后再描述交互',
        })
      }

      const { response, httpStatus } = planEventClarify({
        instruction,
        currentFormJson,
        messages,
      })

      assertEventKeysUnchanged(currentFormJson, response.formJson)

      if (response.applied !== false) {
        return reply.code(500).send({ message: 'v0.7 event endpoint must never set applied=true' })
      }
      if (/已更新事件|已应用\s*JS|已写入事件/i.test(response.summary)) {
        return reply.code(500).send({ message: 'summary must not claim event write' })
      }

      return reply.code(httpStatus).send(response)
    } catch (err) {
      request.log.error(err)
      return reply.code(500).send({
        message: err instanceof Error ? err.message : '事件澄清失败',
      })
    }
  })
}
