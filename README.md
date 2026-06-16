<div align="center">
  <img src="public/icon.png" alt="Lucy Logo" width="128" />
  <h1>Lucy: Voice AI Web Agent</h1>
  <p><strong>Browse the internet entirely by voice. Built for accessibility.</strong></p>
</div>

---

## 🌟 Overview

**Lucy** is a powerful, highly-optimized Chrome extension designed to make web browsing entirely hands-free. By leveraging cutting-edge voice recognition and a multi-LLM architecture, Lucy empowers users to navigate, interact, and consume web content seamlessly using only their voice. 

It uses a robust state machine to handle intent classification, planning, action execution, and DOM interaction.

## ✨ Core Features

- 🎙️ **Voice-Controlled Browsing:** Navigate pages, click links, and interact with elements using natural voice commands.
- ⌨️ **Push-to-Talk:** Conveniently activate listening mode with a dedicated hotkey (`Alt+Shift+V`).
- 🧠 **Multi-LLM Architecture:**
  - **Reasoning/Planning:** Google Cloud Platform (GCP) `gemini-2.5-flash` natively integrated for complex multi-step planning and DOM parsing.
  - **Classification/History:** Cerebras `llama3.1-8b` for ultra-fast state classification and conversation summarization.
  - **Speech-to-Text & Text-to-Speech:** Groq `whisper-large-v3` for high-accuracy voice transcription and audio generation.
- ⚡ **Optimized DOM Parsing:**
  - **Set-of-Marks & TreeWalker:** Advanced DOM serialization to feed relevant UI elements to the LLM.
  - **Viewport Bounding:** Only parses semantic text and markers within the current viewport (+/- 500px) to prevent context exhaustion and token bloating.
- 🛠️ **Resilient State Machine:** 12 distinct reasoning and execution states with automatic replanning and retry mechanisms on rate limit failures.
- 🎨 **Side Panel Interface:** A clean, accessible side panel for real-time transcription, state visualization, and logging.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- npm or yarn

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/imshreyaskn/lucy.git
   cd lucy/voice-agent-extension
   ```
   *(Note: Adjust the path if you cloned this directly into the extension folder)*

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file in the root directory and add your API keys securely:
   ```env
   VITE_GEMINI_API_KEY=your_google_api_key
   VITE_CEREBRAS_API_KEY=your_cerebras_api_key
   VITE_GROQ_API_KEY=your_groq_api_key
   ```
   *API keys are securely read at compile-time for reliability.*

4. **Run the development server:**
   ```bash
   npm run dev
   ```

### Loading the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top right).
3. Click **Load unpacked**.
4. Select the `dist` directory from the `voice-agent-extension` folder.

## 🛠️ Architecture Deep Dive

- **State Manager (`agent-manager.ts`):** Controls the agent loop, transitioning through states like `LISTENING`, `CLASSIFYING`, `PLANNING`, `EXECUTING`, etc.
- **Context Layer (`page-context.ts`, `markers.ts`):** Injects semantic HTML and interactive markers (like bounding box overlays) over clickable elements, deduplicates them, and feeds them into the prompt context.
- **LLM Gateway (`litellm-client.ts`):** Manages direct REST calls to GCP and Cerebras, with automatic 429 rate limit fallbacks to faster backup models (e.g., `llama-3.1-8b-instant`).
- **Telemetry (`logger.ts`):** Includes a local Express server hook (`dev-logger.cjs`) for real-time streaming of AI reasoning states and DOM interactions.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## 📄 License

This project is licensed under the MIT License.
