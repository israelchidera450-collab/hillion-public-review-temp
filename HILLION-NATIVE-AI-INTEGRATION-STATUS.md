# HILLION native AI integration — implementation pass

Date: 15 November 2026

## Implemented in source

- Added `HillionInferencePlugin.kt`, a Capacitor bridge around the pinned `llama.kt` `LlamaEngine` API. It loads the imported GGUF into native memory, runs model chat with the GGUF's chat template, streams tokens to the WebView, supports cancellation, and releases the engine.
- Added `src/utils/aiClient.js`. Android requests use native inference; browser/dev requests retain the OpenAI-compatible HTTP adapter. The adapter returns the same JSON/SSE response shapes consumed by the existing HILLION parsers, so lesson JSON parsing, section autosave, and existing stream handling remain in place.
- Replaced all three active AI HTTP call paths (chat, lesson generation, classroom follow-up) with the shared adapter.
- Replaced the Android lesson health preflight with a check for the imported local model.
- Updated model settings to unload the in-memory model before replacement/removal and to describe first-load behavior.
- Registered the new Capacitor plugin.

## Native engine pin and build requirements

- Engine: `tensai-app/llama.kt` commit `d3c306d60007a714d820cb50c76086bc07aec055`.
- NDK: `27.2.12479018`; CMake: `3.31.6`; Android SDK: API 36; Java: 21.
- The project minimum SDK is raised from 24 to 29 to satisfy the native engine requirement. The target Redmi Android 16 device exceeds this requirement.
- Kotlin Gradle plugin 2.3.0 is selected because its published compatibility table includes AGP 8.13 and Gradle 8.14.3.
- `scripts/setup-native-ai.sh` checks out the pinned engine, initializes its nested submodules, bootstraps its JNI sources, and builds the OpenCL loader required by the upstream CMake target.

## Runtime choices

- CPU inference (`nGpuLayers = 0`) is selected as the conservative default; GPU offload is not enabled without device-specific validation.
- Context is capped at 2048 tokens, matching the existing local llama-server context configuration and limiting memory use.
- The engine is loaded lazily on the first Android request and reused until the model is replaced or removed.

## Verification status

- Source-level changes have been made, but this environment has no npm cache, no Android SDK/NDK, and no Gradle distribution cache. Network DNS was unavailable during earlier dependency installation attempts.
- Therefore this pass has **not** been compiled, packaged into an APK, or run on the Redmi 14C. The CI workflow now provisions the native toolchain and performs the pinned engine bootstrap before the Gradle build; its first run is the next compile gate.
- Standalone behavior is not yet verified. It is only confirmed when an installed APK loads the GGUF and completes chat + lesson generation with Termux and the local HTTP server stopped.
