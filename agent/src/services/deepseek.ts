export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured')
  }

  const baseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const url = `${baseURL}/v1/chat/completions`

  const body = {
    model,
    messages,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  }

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 400)}`)
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('DeepSeek returned empty content')
      return content
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === 0) await sleep(800)
    }
  }
  throw lastError || new Error('DeepSeek request failed')
}
