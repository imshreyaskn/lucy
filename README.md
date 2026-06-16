# Lucy: Voice AI Web Agent

Browse the internet entirely by voice. Built for accessibility.

## Overview

Lucy is a Chrome extension that enables hands-free web browsing. By combining voice recognition with a multi-step agentic LLM architecture, it allows users to navigate, read content, interact with forms, and consume media using natural voice commands.

## Architecture

The extension uses a robust state machine to handle intent classification, planning, action execution, and DOM interaction.

* LLM Routing: All text-based AI reasoning routes through OpenRouter, eliminating the need for multiple cloud provider integrations. Users can select models dynamically via the UI.
* Planning State: Hardcoded to use `meta-llama/llama-3.1-70b-instruct` (via OpenRouter) for complex multi-step planning and DOM parsing.
* Classification & History: Uses `meta-llama/llama-3.1-8b-instruct` for fast intent classification and conversation memory compression.
* Audio Processing: Uses Groq API for high-speed Speech-to-Text (`whisper-large-v3`) and Text-to-Speech generation.
* DOM Parsing: Implements "Set-of-Marks" and TreeWalker semantics. To prevent context exhaustion, bounding logic only parses interactive elements currently visible within the viewport.
* Context Awareness: Fetches user IP location to automatically localize search queries and domains.
* Telemetry: Features an integrated logging system that streams real-time execution states for debugging.

## Features

* Voice-Controlled Browsing: Navigate pages, click links, and interact with elements using natural voice commands.
* Push-to-Talk: Hold `Alt+Shift+V` to activate listening mode.
* Resilient Execution: 12 execution states (e.g., CLASSIFYING, PLANNING, EXECUTING, RECOVERING) with automatic replanning on failure and built-in rate limit management.
* Side Panel UI: A clean interface for real-time transcription, chat history, and configuration settings.

## Getting Started

### Prerequisites

* Node.js (v16 or higher)
* npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/imshreyaskn/lucy.git
   cd lucy/voice-agent-extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add your API keys:
   ```env
   VITE_OPENROUTER_API_KEY=your_openrouter_api_key
   VITE_GROQ_API_KEY=your_groq_api_key
   ```
   Alternatively, you can input these keys directly into the extension's settings panel.

4. Run the development server:
   ```bash
   npm run dev
   ```

### Loading the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `dist` directory from the `voice-agent-extension` folder.

## License

This project is licensed under the MIT License.
