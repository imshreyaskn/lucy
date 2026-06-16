<div align="center">
  <img src="public/icon.png" alt="Lucy Logo" width="128" />
  <h1>Lucy: Voice Agent Extension</h1>
  <p><strong>Browse the internet entirely by voice. Built for accessibility.</strong></p>
</div>

---

## 🌟 Overview

**Lucy** is a powerful Chrome extension designed to make web browsing entirely hands-free. By leveraging cutting-edge voice recognition and AI, Lucy empowers users to navigate, interact, and consume web content seamlessly using only their voice.

## ✨ Features

- 🎙️ **Voice-Controlled Browsing:** Navigate pages, click links, and interact with elements using natural voice commands.
- ⌨️ **Push-to-Talk:** Conveniently activate listening mode with a dedicated hotkey (`Alt+Shift+V`).
- 🤖 **AI-Powered Agent:** Intelligently processes your commands to perform complex web interactions.
- 🎨 **Side Panel Interface:** A clean, accessible side panel for real-time transcription and feedback.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- npm or yarn

### Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd voice-agent-extension
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file in the root directory and add your necessary API keys.
   *Note: Ensure your `google-credentials.json` is correctly placed if using Google Cloud services.*

4. **Run the development server:**
   ```bash
   npm run dev
   ```

### Loading the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top right).
3. Click **Load unpacked**.
4. Select the `dist` directory from the `voice-agent-extension` folder.

## 🛠️ Tech Stack

- **Framework:** [Vite](https://vitejs.dev/) with TypeScript
- **Extension Tooling:** CRXJS Vite Plugin
- **Language:** TypeScript

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## 📄 License

This project is licensed under the MIT License.
