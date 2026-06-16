# Lucy: Voice AI Web Agent

Browse the internet entirely by voice. Built for accessibility.

## Overview

Lucy is a Chrome extension designed to make web browsing hands-free. By leveraging voice recognition and a multi-LLM architecture, it empowers users to navigate, interact, and consume web content seamlessly using only their voice.

## Core Features

* Voice-Controlled Browsing: Navigate pages, click links, and interact with elements using natural voice commands.
* Push-to-Talk: Activate listening mode with `Alt+Shift+V`.
* Multi-LLM Architecture:
  * Reasoning/Planning: Google Cloud Platform (GCP) gemini-2.5-flash for complex multi-step planning and DOM parsing.
  * Classification/History: Cerebras llama3.1-8b for fast state classification and conversation summarization.
  * Speech-to-Text & Text-to-Speech: Groq whisper-large-v3 for high-accuracy voice transcription and audio generation.
* Optimized DOM Parsing: Uses Set-of-Marks and TreeWalker for advanced DOM serialization. Bounding logic parses only the elements within the current viewport to prevent context exhaustion.
* Resilient State Machine: 12 reasoning and execution states with automatic replanning and retry mechanisms on rate limit failures.

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
   VITE_GEMINI_API_KEY=your_google_api_key
   VITE_CEREBRAS_API_KEY=your_cerebras_api_key
   VITE_GROQ_API_KEY=your_groq_api_key
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

### Loading the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `dist` directory from the `voice-agent-extension` folder.

## Architecture

* State Manager: Controls the agent loop, transitioning through reasoning and execution states.
* Context Layer: Injects semantic HTML and interactive markers over clickable elements, deduplicates them, and feeds them into the prompt context.
* LLM Gateway: Manages REST calls to GCP and Cerebras, with automatic 429 rate limit fallbacks.

## License

This project is licensed under the MIT License.
