# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.


## Android build environment

`android/local.properties` is intentionally not included in the source archive because it contains a machine-specific Android SDK path. The GitHub Actions workflow writes the runner's own SDK path before invoking Gradle. For a local build, let Android Studio or the local Gradle environment generate this file, or set `ANDROID_HOME`/`ANDROID_SDK_ROOT` appropriately.

## Android on-device AI engine

The Android source now has a native inference path built around a pinned `llama.kt` / `llama.cpp` engine. The `HillionInference` Capacitor plugin loads the GGUF model from the app-managed private model folder, applies the model's own chat template, streams tokens to the WebView, and supports cancellation. The web preview retains the OpenAI-compatible HTTP adapter.

The three active HILLION AI flows (chat, lesson generation, and classroom follow-up) now use the shared `src/utils/aiClient.js` adapter. On Android they route to native inference rather than `127.0.0.1:8080`. The model is loaded lazily on the first request and reused; CPU inference and a 2048-token context are the conservative defaults.

### Native engine build

The build uses `tensai-app/llama.kt` pinned to commit `d3c306d60007a714d820cb50c76086bc07aec055`, Android NDK `27.2.12479018`, CMake `3.31.6`, Java 21, Android API 36, and Kotlin Gradle plugin `2.3.0`. The app minimum SDK is 29 to meet the engine's Android 10+ requirement.

GitHub Actions installs the native build tools and runs `scripts/setup-native-ai.sh` before the Gradle build. That script adds/checks out the pinned engine submodule, initializes its nested sources, bootstraps the JNI implementation, and builds the OpenCL loader required by the upstream native target.

### Verification gate

The source adapter and Kotlin Capacitor bridge are implemented, but this archive has **not yet passed a native Gradle build**. The current execution environment has no installed Android SDK/NDK or Gradle distribution cache and no npm package cache, so it cannot produce a verified APK here. The first GitHub Actions run is the next compile gate. After it passes, install the APK on the Redmi 14C and test model import, model loading, chat, complete lesson streaming, cancellation, lesson resume, app background/foreground, and cold restart with Termux and the local HTTP server stopped.

HILLION must not be described as release-complete until those build and device tests pass. Narration still uses browser speech synthesis, and subject-specific visual coverage still needs a separate full quality pass.
