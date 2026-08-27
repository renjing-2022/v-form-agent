import type { FastifyInstance } from 'fastify'
import { assembleFormJson } from '../services/assembler.js'
import { parseAssessmentExcel } from '../services/excelParser.js'
import { planFromExcelDigest, planFromText } from '../services/planner.js'
import { validateFormJson } from '../services/validator.js'

const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024)

export async function registerGenerateRoutes(app: FastifyInstance) {
  app.post('/api/agent/v1/generate', async (request, reply) => {
    try {
      const contentType = String(request.headers['content-type'] || '')
      let mode: 'text' | 'excel' = 'text'
      let prompt = ''
      let fileBuffer: Buffer | null = null
      let filename = ''

      if (contentType.includes('multipart/form-data')) {
        const parts = request.parts()
        for await (const part of parts) {
          if (part.type === 'file') {
            filename = part.filename || 'upload.xlsx'
            const buf = await part.toBuffer()
            if (buf.length > MAX_UPLOAD) {
              return reply.code(400).send({ message: `文件过大，上限 ${MAX_UPLOAD} 字节` })
            }
            fileBuffer = buf
          } else {
            const value = String(part.value || '')
            if (part.fieldname === 'mode') mode = value === 'excel' ? 'excel' : 'text'
            if (part.fieldname === 'prompt') prompt = value
          }
        }
        if (fileBuffer) mode = 'excel'
      } else {
        const body = (request.body || {}) as { mode?: string; prompt?: string }
        mode = body.mode === 'excel' ? 'excel' : 'text'
        prompt = body.prompt || ''
      }

      if (mode === 'text') {
        if (!prompt.trim()) {
          return reply.code(400).send({ message: 'prompt 不能为空' })
        }
        const plan = await planFromText(prompt.trim())
        const formJson = assembleFormJson(plan)
        const issues = validateFormJson(formJson)
        if (issues.length) {
          return reply.code(422).send({
            message: '生成结果未通过校验',
            issues,
          })
        }
        const fieldCount = plan.sections.reduce((n, s) => n + s.fields.length, 0)
        return {
          summary: `已生成「${plan.formTitle}」，共 ${plan.sections.length} 个分区、${fieldCount} 个字段`,
          warnings: process.env.DEEPSEEK_API_KEY ? [] : ['当前使用 mock/本地规划（未配置 DeepSeek Key）'],
          formJson,
        }
      }

      // excel mode
      if (!fileBuffer) {
        return reply.code(400).send({ message: 'excel 模式需要上传 file' })
      }
      if (!/\.(xlsx|xls)$/i.test(filename) && filename) {
        // still try parse; warn
      }
      if (fileBuffer.length === 0) {
        return reply.code(400).send({ message: '上传文件为空' })
      }

      let digest
      try {
        digest = parseAssessmentExcel(fileBuffer)
      } catch (err) {
        return reply.code(400).send({
          message: `Excel 解析失败：${err instanceof Error ? err.message : String(err)}`,
        })
      }

      const { plan, warnings } = await planFromExcelDigest(digest, prompt)
      const formJson = assembleFormJson(plan)
      const issues = validateFormJson(formJson)
      if (issues.length) {
        return reply.code(422).send({
          message: '生成结果未通过校验',
          issues,
          warnings,
        })
      }
      const fieldCount = plan.sections.reduce((n, s) => n + s.fields.length, 0)
      return {
        summary: `已根据 Excel 生成「${plan.formTitle}」，共 ${plan.sections.length} 个分区、${fieldCount} 个字段`,
        warnings,
        formJson,
      }
    } catch (err) {
      request.log.error(err)
      return reply.code(500).send({
        message: err instanceof Error ? err.message : '生成失败',
      })
    }
  })
}
