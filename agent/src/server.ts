import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { registerGenerateRoutes } from './routes/generate.js'
import { registerRefineRoutes } from './routes/refine.js'
import { registerEventRoutes } from './routes/event.js'
import { registerInteractionRoutes } from './routes/interaction.js'

const port = Number(process.env.PORT || 3040)

async function main() {
  const app = Fastify({ logger: true })
  await app.register(cors, { origin: true })
  await app.register(multipart, {
    limits: {
      fileSize: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
    },
  })

  app.get('/health', async () => ({
    ok: true,
    service: 'v-form-agent',
    port,
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
  }))

  await registerGenerateRoutes(app)
  await registerRefineRoutes(app)
  await registerEventRoutes(app)
  await registerInteractionRoutes(app)

  await app.listen({ port, host: '0.0.0.0' })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
