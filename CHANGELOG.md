# Changelog

All notable changes to the Voice AI Web Agent project will be documented in this file.

## [2026-06-08 14:46 UTC] - Shift to Nvidia NIM
### Changed
- **Nvidia NIM Integration**: Swapped the Mistral API endpoint to `integrate.api.nvidia.com` to leverage Nvidia's lightning-fast enterprise infrastructure.
- **Model Re-mapping**: Updated standard Mistral models to NIM's format (`mistralai/mistral-large` and `mistralai/mistral-7b-instruct-v0.3`).

## [2026-06-08 14:40 UTC] - Re-Pivot to Mistral
### Changed
- **Abandoned Gemini Free Tier**: Gemini's `1.5-flash` limits (1500 RPD) and `2.0/2.5-flash` limits (0-20 RPD) proved too restrictive for a looping voice agent.
- **Mistral Re-Integration**: Shifted Planner to `mistral-large-latest` and Classifier/History to `mistral-small-latest`.
- **Throttling Preserved**: Maintained the 12.1-second global queue to guarantee the agent never exceeds 5 Requests Per Minute, maximizing stability.

## [2026-06-08 13:55 UTC] - GCP Standardization (Removed Bloatware)
### Removed
- **Multi-LLM Bloatware Removed**: Stripped out `Mistral`, `Cerebras`, and `OpenRouter` integration entirely from `litellm-client.ts`.
- Removed their respective environment variables.
### Changed
- **Fully Standardized on Google Cloud**: The entire reasoning architecture (State Classification, Planning, and History Management) now strictly routes through GCP's `gemini-2.5-flash` natively.
- Kept **Groq** only for Whisper V3 STT and TTS functionality, as GCP lacks a comparable free Audio API.

## [2026-06-08 13:35 UTC] - Native Multi-LLM Architecture Pivot (OpenRouter Abandoned)
### Added
- **Hardcoded API Keys**: Removed the frontend Settings UI completely. API Keys are now securely read from `.env` environment variables at compile-time for maximum reliability and ease of use.
### Changed
- **Abandoned OpenRouter**: Due to extreme volatility and upstream rate-limits on OpenRouter's free tier, we pivoted the architecture to communicate directly with official developer APIs.
- **Native Gemini Integration**: Rewrote the heavy Planning state to connect directly to Google AI Studio's `gemini-2.5-flash` API.
- **Native Cerebras Integration**: Rewrote the fast Classification and History summarization states to connect directly to Cerebras' ultra-fast `llama3.1-8b` API.

## [2026-06-08 13:20 UTC] - OpenRouter Pivot (Deprecated)
### Added
- Integrated **OpenRouter** as the core LLM provider in `litellm-client.ts`, centralizing AI reasoning without needing to configure three separate clouds.
- Updated the Extension Sidepanel UI to accept an `OpenRouter API Key`.
### Changed
- Migrated the heavy-lifting Planner logic in `planning.ts` to `google/gemini-2.5-flash:free` via OpenRouter to eliminate context length exhaustion.
- Migrated the fast State Classifier and Summarizer in `classifying.ts` & `history-manager.ts` to `google/gemini-2.5-flash:free` to bypass Groq's low TPM rate limits.
### Fixed
- Fixed an unhandled promise crash inside `AgentManager` that would silently fail if the OpenRouter API Key was missing by surfacing the error to the UI and Text-to-Speech engine.

## [2026-06-08 12:51 UTC] - Token Optimization (DOM Compression)
### Changed
- Implemented **Viewport Bounding**: Modified `dom-utils.ts` and `page-context.ts` so the agent only parses markers and semantic text for elements currently within the viewport (+/- 500px).
- Implemented **Deduplication**: Filtered redundant markers in `markers.ts` (e.g. YouTube thumbnails and titles linking to the same `href`).
- Aggressively truncated semantic context from 5,000 to 2,000 characters to prevent Groq `429` rate limit token exhaustion.

## [2026-06-08 12:47 UTC] - STT Upgrade & Rate Limit Fallback
### Added
- Implemented an automatic LLM fallback in `litellm-client.ts`. If Groq throws a `429 Rate Limit Exceeded` error (often caused by large DOM payloads on the free tier), the agent will automatically retry the request using the smaller, faster `llama-3.1-8b-instant` model.
### Changed
- Switched the STT model from `whisper-large-v3-turbo` to `whisper-large-v3` for improved transcription accuracy on conversational queries.


## [2026-06-08 12:44 UTC] - Navigation Race Condition Fix
### Added
- Implemented `chrome.tabs.onUpdated` listener in `background.ts` to actively wait for page navigation to complete (`info.status === 'complete'`) before yielding control back to the agent loop.
### Fixed
- Fixed an issue where the agent would crash on multi-step tasks involving navigation (e.g., "Open YouTube and search..."). The planner was executing Step 2 (`type`) before the YouTube DOM and content scripts were loaded.
- Wrapped the DOM message dispatcher `chrome.tabs.sendMessage` in `sidepanel.ts` inside a robust `try/catch`. If an execution fails due to missing content scripts, the agent gracefully recovers via `REPLANNING` instead of throwing an unhandled exception.

## [2026-06-08 12:41 UTC] - Telemetry & Live Sync
### Added
- Created `dev-logger.cjs`, a local Express server listening on port 18080 to receive streaming logs from the extension.
- Added `fetch('http://localhost:18080/log')` inside `logger.ts` to push logs to the local file `agent-debug.log` for real-time AI debugging.

## [2026-06-08 12:39 UTC] - Centralized Logging System
### Added
- Implemented `src/lib/logger.ts` to track state transitions, LLM reasoning, API errors, and DOM interactions in a 500-entry ring buffer.
- Integrated `logger.info`, `logger.debug`, and `logger.error` deep into `agent-manager.ts` and `litellm-client.ts`.
- Added a "Download Logs" button in the side panel settings to allow the user to dump the buffer to a `.json` file for manual inspection.

## [2026-06-08 12:37 UTC] - Microphone Permission Bridge
### Added
- Created a dedicated `options.html` and `options.ts` page to act as a permission conduit, bypassing Manifest V3's side-panel prompt suppression.
- Updated `sidepanel.ts` to catch `NotAllowedError` automatically when requesting the microphone and instantly open the Options page so the user can grant access.

## [2026-06-08 11:15 UTC] - Initial Architecture Scaffold
### Added
- Scaffolded Vite + React + CRXJS extension.
- Built Context Layer: `markers.ts` (Set-of-Marks) and `page-context.ts` (TreeWalker semantics).
- Built State Machine: `agent-manager.ts` with 12 distinct reasoning/execution states.
- Built STT and TTS hooks using Groq Whisper and PlayAI (`groq-stt.ts`, `groq-tts.ts`).
- Built LiteLLM integration for fallback between Llama-3 and Gemini 2.5 Flash.
