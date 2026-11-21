package com.hillion.aitutor

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.tensai.llamakt.ChatMessage
import com.tensai.llamakt.LlamaEngine
import com.tensai.llamakt.SamplingParams
import com.tensai.llamakt.chat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@CapacitorPlugin(name = "HillionInference")
class HillionInferencePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val engineMutex = Mutex()
    private val generationMutex = Mutex()
    private val jobs = ConcurrentHashMap<String, Job>()

    @Volatile private var engine: LlamaEngine? = null
    @Volatile private var loadedPath: String? = null
    @Volatile private var loadedLength: Long = -1L
    @Volatile private var loadedModified: Long = -1L
    @Volatile private var activeRequestId: String? = null

    private fun modelFile(): File {
        var appFiles = getContext().getExternalFilesDir(null)
        if (appFiles == null) appFiles = getContext().filesDir
        return File(File(appFiles, "models"), "hillion-model.gguf")
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val file = modelFile()
        val result = JSObject()
        result.put("modelReady", file.isFile && file.length() > 0L)
        result.put("loaded", engine != null && loadedPath == file.absolutePath && loadedLength == file.length() && loadedModified == file.lastModified())
        result.put("sizeBytes", if (file.isFile) file.length() else 0L)
        call.resolve(result)
    }

    @PluginMethod
    fun loadModel(call: PluginCall) {
        scope.launch {
            try {
                generationMutex.withLock { ensureEngine() }
                val result = JSObject()
                result.put("loaded", true)
                result.put("contextTokens", 2048)
                call.resolve(result)
            } catch (error: Exception) {
                call.reject("HILLION could not load the on-device AI model: ${error.message}")
            }
        }
    }

    @PluginMethod
    fun generate(call: PluginCall) {
        val requestId = call.getString("requestId") ?: UUID.randomUUID().toString()
        val rawMessages = call.getData().optJSONArray("messages")
        if (rawMessages == null || rawMessages.length() == 0) {
            call.reject("The AI request did not contain any messages.")
            return
        }
        val messages = (0 until rawMessages.length()).mapNotNull { index ->
            val item = rawMessages.optJSONObject(index) ?: return@mapNotNull null
            val role = item.optString("role", "user")
            val content = item.optString("content", "")
            if (content.isBlank()) null else ChatMessage(role, content)
        }
        if (messages.isEmpty()) {
            call.reject("The AI request contained no usable message text.")
            return
        }

        val maxTokens = (call.getInt("maxTokens") ?: 512).coerceIn(1, 1800)
        val temperature = (call.getDouble("temperature") ?: 0.3).toFloat().coerceIn(0f, 2f)
        val repeatPenalty = (call.getDouble("repeatPenalty") ?: 1.15).toFloat().coerceIn(1f, 2f)
        val repeatLastN = (call.getInt("repeatLastN") ?: 256).coerceIn(0, 2048)

        val job = scope.launch(start = kotlinx.coroutines.CoroutineStart.LAZY) {
            try {
                generationMutex.withLock {
                    activeRequestId = requestId
                    val activeEngine = ensureEngine()
                    val params = SamplingParams(
                        nPredict = maxTokens,
                        temperature = temperature,
                        repeatPenalty = repeatPenalty,
                        repeatLastN = repeatLastN
                    )
                    activeEngine.chat(messages, params).collect { token ->
                        val event = JSObject()
                        event.put("requestId", requestId)
                        event.put("token", token)
                        notifyListeners("generationToken", event)
                    }
                    val event = JSObject()
                    event.put("requestId", requestId)
                    notifyListeners("generationComplete", event)
                    activeRequestId = null
                }
            } catch (cancelled: CancellationException) {
                activeRequestId = null
                val event = JSObject()
                event.put("requestId", requestId)
                notifyListeners("generationCancelled", event)
                throw cancelled
            } catch (error: Exception) {
                activeRequestId = null
                val event = JSObject()
                event.put("requestId", requestId)
                event.put("error", error.message ?: "Unknown native inference error")
                notifyListeners("generationError", event)
            } finally {
                jobs.remove(requestId)
            }
        }
        jobs[requestId] = job
        job.start()
        val accepted = JSObject()
        accepted.put("requestId", requestId)
        call.resolve(accepted)
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val requestId = call.getString("requestId") ?: ""
        if (activeRequestId == requestId) engine?.interrupt()
        jobs[requestId]?.cancel()
        call.resolve()
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        jobs.values.forEach { it.cancel() }
        engine?.interrupt()
        scope.launch {
            try {
                generationMutex.withLock {
                    engineMutex.withLock {
                        engine?.free()
                        engine = null
                        loadedPath = null
                        loadedLength = -1L
                        loadedModified = -1L
                    }
                }
                call.resolve()
            } catch (error: Exception) {
                call.reject("Could not release the on-device AI model: ${error.message}")
            }
        }
    }

    private suspend fun ensureEngine(): LlamaEngine = engineMutex.withLock {
        val file = modelFile()
        if (!file.isFile || file.length() <= 0L) {
            throw IllegalStateException("No GGUF model is stored. Import the model from HILLION Settings first.")
        }

        val current = engine
        if (current != null && loadedPath == file.absolutePath && loadedLength == file.length() && loadedModified == file.lastModified()) {
            return@withLock current
        }

        current?.free()
        engine = null
        val metadata = LlamaEngine.readMetadata(file.absolutePath)
            ?: throw IllegalArgumentException("HILLION could not read the GGUF model metadata. Please import a valid GGUF file.")
        if (metadata.fileSizeBytes != file.length()) {
            throw IllegalArgumentException("The GGUF model file appears incomplete. Please import it again.")
        }

        val next = LlamaEngine()
        try {
            withContext(Dispatchers.IO) {
                // CPU-only is the safest baseline for this device. Context is capped at
                // 2048 tokens to keep memory use bounded on mid-range Android hardware.
                next.load(path = file.absolutePath, nGpuLayers = 0, nCtx = 2048, nThreads = 0)
            }
        } catch (error: Exception) {
            try { next.free() } catch (_: Exception) { }
            throw error
        }

        engine = next
        loadedPath = file.absolutePath
        loadedLength = file.length()
        loadedModified = file.lastModified()
        next
    }

    override fun handleOnDestroy() {
        jobs.values.forEach { it.cancel() }
        engine?.interrupt()
        scope.launch {
            try {
                generationMutex.withLock {
                    engineMutex.withLock {
                        engine?.free()
                        engine = null
                    }
                }
            } catch (_: Exception) { }
        }
        super.handleOnDestroy()
    }
}
