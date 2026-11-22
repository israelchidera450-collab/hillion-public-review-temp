import { Capacitor, registerPlugin } from '@capacitor/core'

const HillionInference = registerPlugin('HillionInference')
const AI_BASE_URL = (import.meta.env.VITE_AI_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '')
const AI_CHAT_COMPLETIONS_URL = import.meta.env.DEV
  ? '/api/ai/v1/chat/completions'
  : `${AI_BASE_URL}/v1/chat/completions`
const AI_HEALTH_URL = import.meta.env.DEV ? '/api/ai/health' : `${AI_BASE_URL}/health`
const isAndroidNative = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

function makeRequestId() {
  return globalThis.crypto?.randomUUID?.() || `hillion-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function asAbortError() {
  return new DOMException('AI generation was cancelled.', 'AbortError')
}

export async function checkAIAvailability({ signal } = {}) {
  if (signal?.aborted) throw asAbortError()

  if (isAndroidNative()) {
    const status = await HillionInference.getStatus()
    if (!status.modelReady) {
      throw new Error('No on-device AI model is installed. Open Settings and import your Qwen GGUF model first.')
    }
    return { ready: true, mode: 'on-device', loaded: Boolean(status.loaded) }
  }

  const response = await fetch(AI_HEALTH_URL, {
    method: 'GET',
    cache: 'no-store',
    signal
  })
  if (!response.ok) throw new Error(`The AI engine health check returned HTTP ${response.status}.`)
  return { ready: true, mode: 'http' }
}

async function requestAndroidAI(payload, signal) {
  if (signal?.aborted) throw asAbortError()

  const status = await HillionInference.getStatus()
  if (!status.modelReady) {
    throw new Error('No on-device AI model is installed. Open Settings and import your Qwen GGUF model first.')
  }
  if (!status.loaded) {
    // The model is loaded once into native memory and reused for later requests.
    await HillionInference.loadModel()
  }

  const requestId = makeRequestId()
  const streaming = payload.stream === true
  const encoder = new TextEncoder()
  let controller = null
  let accumulated = ''
  let settled = false
  let removeListeners = []
  let resolveCompletion
  let rejectCompletion
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })
  completion.catch(() => {})

  const cleanup = async () => {
    const removers = removeListeners
    removeListeners = []
    await Promise.all(removers.map(remove => Promise.resolve(remove()).catch(() => {})))
    signal?.removeEventListener('abort', onAbort)
  }

  const finish = async (error = null) => {
    if (settled) return
    settled = true
    await cleanup()
    if (error) {
      if (controller) {
        try { controller.error(error) } catch { }
      }
      rejectCompletion(error)
      return
    }
    if (controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch { }
    }
    resolveCompletion(accumulated)
  }

  const onAbort = () => {
    HillionInference.cancel({ requestId }).catch(() => {})
    void finish(asAbortError())
  }

  const stream = streaming ? new ReadableStream({ start(value) { controller = value } }) : null

  // Listener setup is a partial-failure boundary: if any later registration
  // fails, remove every listener already attached before returning the error.
  try {
    const tokenHandle = await HillionInference.addListener('generationToken', event => {
      if (event.requestId !== requestId || settled || typeof event.token !== 'string') return
      accumulated += event.token
      if (controller) {
        const chunk = { choices: [{ delta: { content: event.token }, finish_reason: null }] }
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)) } catch { }
      }
    })
    removeListeners.push(() => tokenHandle.remove())

    const completeHandle = await HillionInference.addListener('generationComplete', event => {
      if (event.requestId === requestId) void finish()
    })
    removeListeners.push(() => completeHandle.remove())

    const errorHandle = await HillionInference.addListener('generationError', event => {
      if (event.requestId === requestId) void finish(new Error(event.error || 'The on-device AI engine failed.'))
    })
    removeListeners.push(() => errorHandle.remove())

    const cancelledHandle = await HillionInference.addListener('generationCancelled', event => {
      if (event.requestId === requestId) void finish(asAbortError())
    })
    removeListeners.push(() => cancelledHandle.remove())
  } catch (error) {
    await cleanup()
    throw error
  }

  if (settled || signal?.aborted) {
    await cleanup()
    throw asAbortError()
  }

  try {
    await HillionInference.generate({
      requestId,
      messages: payload.messages || [],
      maxTokens: payload.max_tokens || 512,
      temperature: payload.temperature ?? 0.3,
      repeatPenalty: payload.repeat_penalty ?? 1.15,
      repeatLastN: payload.repeat_last_n ?? 256
    })
  } catch (error) {
    await finish(error instanceof Error ? error : new Error(String(error)))
    throw error
  }

  // Attach cancellation only after the native request has been registered. This
  // prevents an abort in the tiny startup window from cancelling an unknown ID
  // and then accidentally allowing generation to start anyway.
  if (signal && !settled) {
    if (signal.aborted) {
      onAbort()
      throw asAbortError()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  if (streaming) {
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' }
    })
  }

  const text = await completion
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export function requestAI(payload, { signal } = {}) {
  if (isAndroidNative()) return requestAndroidAI(payload, signal)
  return fetch(AI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

export async function unloadOnDeviceAI() {
  if (!isAndroidNative()) return
  await HillionInference.unloadModel()
}
