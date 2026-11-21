HILLION ANDROID AI ENGINE — IMPLEMENTATION TRACK

CURRENT SOURCE STATE
- The existing web app calls OpenAI-compatible HTTP endpoints at 127.0.0.1:8080.
- The new HillionModelManager plugin can import and manage a GGUF file in app-specific Android storage.
- The selected import target filename is app-private `models/hillion-model.gguf` under Android's app-specific external files directory (internal files directory fallback).
- Model import is NOT model inference. The app still needs the llama-server process today.

NATIVE ENGINE CANDIDATE
- Prefer the official llama.cpp Android example as the primary reference. Its current Android documentation describes GGUF metadata reading, app-private model paths, an AiChat facade / InferenceEngine, and token generation through Kotlin Flow.
- Evaluate the llama.kt binding as an alternative only after checking the exact pinned revision, native build configuration, license notices, and device compatibility.
- Do not add an unpinned or unverified binary dependency and claim it works.

REQUIRED NEXT IMPLEMENTATION
1. Pin a reviewed llama.cpp revision and integrate its Android native engine for arm64-v8a.
2. Implement a Kotlin Capacitor plugin that loads/unloads the stored GGUF, reports model metadata and memory errors, and streams generated tokens to JS with a request ID and cancellation support.
3. Replace all three fetch call paths in src/App.jsx (chat, lesson generation, and classroom follow-up) with one AI adapter that selects the native engine on Android and keeps the HTTP adapter only for development/web fallback.
4. Preserve existing message/lesson JSON contracts, streaming parser behavior, AbortController semantics, and lesson autosave/resume behavior.
5. Add model loading progress, insufficient-storage/RAM diagnostics, app background/foreground handling, and safe release on exit.
6. Build arm64-v8a APK in CI, install on the target Redmi device, import the model, run a short chat, generate a complete lesson, interrupt/resume, background/foreground, and cold-restart without Termux.

RELEASE GATE
Do not call the app standalone until the installed APK can load the model and complete both chat and lesson generation with Termux stopped and no local HTTP server running.
