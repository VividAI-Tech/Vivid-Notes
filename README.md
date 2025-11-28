# VividAI

<div align="center">
  <img src="assets/readme-banner.png" alt="VividAI Hero Banner" width="100%">
  <br>
  <h1>Meeting Transcriber & Summarizer</h1>
  <p>
    <strong>Record, Transcribe, and Summarize your meetings with AI power.</strong>
  </p>
  <p>
    <a href="#features">Features</a> •
    <a href="#installation">Installation</a> •
    <a href="#usage">Usage</a> •
    <a href="#configuration">Configuration</a>
  </p>
</div>

---

**VividAI** is a powerful Chrome extension that transforms your browser into an intelligent meeting assistant. Whether you're on Google Meet, Zoom, or Teams, VividAI captures the audio, transcribes it in real-time using OpenAI's Whisper, and generates concise, actionable summaries using advanced LLMs.

## 🚀 Features

- **🎙️ Universal Recording**: Works on Google Meet, Zoom, Webex, Microsoft Teams, and WhatsApp Web.
- **⚡ Real-time Transcription**: Powered by OpenAI Whisper for industry-leading accuracy.
- **📝 Smart Summaries**: Automatically generates meeting titles, key takeaways, decisions, and action items.
- **🌍 Multi-Language**: Auto-detects languages and provides English translations on the fly.
- **🤖 Flexible AI**: Bring your own key! Supports OpenAI, Google Gemini, Groq, OpenRouter, and local Ollama models.
- **📊 Audio Visualizer**: Beautiful real-time audio wave visualization during recording.
- **💾 Local Privacy**: Your API keys and recordings are stored locally in your browser.

## 🏆 Why VividAI?

Unlike other meeting assistants that require bots to join your calls or store your data on their servers, VividAI runs entirely in your browser.

| Feature | VividAI | Others (Otter, Fireflies, etc.) |
| :--- | :---: | :---: |
| **Privacy** | 🔒 **High** (Local Keys & Data) | ⚠️ Medium (Cloud Storage) |
| **Bot Required** | ❌ **No** (Invisible Tab Capture) | ✅ Yes (Often Intrusive) |
| **AI Model** | 🧠 **Flexible** (OpenAI, Gemini, Ollama) | 🔒 Fixed / Proprietary |
| **Cost** | 💸 **At-Cost** (Free $120/mo OpenAI Credits) | 💳 Monthly Subscription ($10-30/mo) |
| **Offline AI** | ✅ **Yes** (Ollama Support) | ❌ No |

## 📦 Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/yourusername/vividai.git
    ```

2.  **Load in Chrome**
    - Open `chrome://extensions`
    - Enable **Developer mode** (top right toggle)
    - Click **Load unpacked**
    - Select the `vividai` directory

3.  **Pin It**: Click the puzzle icon in Chrome and pin **VividAI** for easy access.

## 🛠️ Configuration

Before you start, you'll need to configure your AI provider.

1.  Click the **VividAI icon** in the toolbar.
2.  Click the **Settings (Gear)** icon.
3.  Select your **AI Provider** (e.g., OpenAI, Gemini, Groq).
4.  Enter your **API Key**.
    - [Get OpenAI Key](https://platform.openai.com/api-keys) (OpenAI gives **$120/mo free credits**, enough for ~300 hours!)
    - [Get Gemini Key](https://aistudio.google.com/apikey)
    - [Get Groq Key](https://console.groq.com/keys)
5.  Click **Save Settings** and **Test Connection**.

## 🎮 Usage

### 1. Start a Meeting
Join a meeting on any supported platform (e.g., Google Meet).

### 2. Record
Click the VividAI extension icon and hit **Start Recording**. The extension will capture the tab's audio.

### 3. Transcribe & Summarize
Watch the transcription happen in real-time (if enabled) or wait for the final processing. Once stopped, you'll get:
- Full **Transcript** with timestamps.
- AI-generated **Summary** with bullet points.

### 4. Export
Copy the results to your clipboard or export as a JSON file for your records.

## 🧩 Supported Platforms

| Platform | Status |
|----------|:------:|
| Google Meet | ✅ |
| Zoom (Web) | ✅ |
| Microsoft Teams | ✅ |
| Cisco Webex | ✅ |
| WhatsApp Web | ✅ |

## 🔒 Privacy First

VividAI is designed with privacy in mind:
- **No Backend Server**: The extension talks directly to the AI APIs (OpenAI, etc.) from your browser.
- **Local Storage**: Your recordings and API keys are stored in your browser's local storage.
- **Open Source**: You can inspect the code to see exactly what it does.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <sub>Made with ❤️ for productive meetings</sub>
</div>
