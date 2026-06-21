// src/sidepanel/sidepanel.ts
import { AgentManager } from '../lib/agent-manager';
import type { AgentState } from '../lib/agent-manager';
import { logger } from '../lib/logger';
import { transcribeAudio, isSilenceHallucination } from '../lib/groq-stt';
import { speakText, stopAudio } from '../lib/groq-tts';
import { callLLM } from '../lib/litellm-client';
import { fetchUserLocation } from '../lib/ip-location';

let isRecording = false;
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let groqApiKey = '';
let openRouterApiKey = '';
let zaiApiKey = '';

const indicator = document.getElementById('mic-indicator')!;
const stateText = document.getElementById('agent-state')!;
const chatLog = document.getElementById('chat-log')!;
const debugLog = document.getElementById('debug-log')!;
const resetBtn = document.getElementById('reset-btn')!;
const debugBtn = document.getElementById('debug-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsView = document.getElementById('settings-view')!;

const llmModelSelect = document.getElementById('llm-model') as HTMLSelectElement;
const openRouterApiKeyInput = document.getElementById('openrouter-api-key') as HTMLInputElement;
const groqApiKeyInput = document.getElementById('groq-api-key') as HTMLInputElement;
const rateLimitToggle = document.getElementById('rate-limit-toggle') as HTMLInputElement;
const rateLimitDurationInput = document.getElementById('rate-limit-duration') as HTMLInputElement;
const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement;
const saveStatus = document.getElementById('save-status')!;

let isDebugVisible = false;
let isSettingsVisible = false;

debugBtn.addEventListener('click', () => {
  isDebugVisible = !isDebugVisible;
  if (isDebugVisible) {
    chatLog.classList.add('hidden');
    settingsView.classList.add('hidden');
    debugLog.classList.remove('hidden');
    debugBtn.style.color = 'var(--text-color)';
    debugLog.scrollTop = debugLog.scrollHeight;
    
    isSettingsVisible = false;
    settingsBtn.style.color = 'var(--text-muted)';
  } else {
    debugLog.classList.add('hidden');
    chatLog.classList.remove('hidden');
    debugBtn.style.color = 'var(--text-muted)';
    chatLog.scrollTop = chatLog.scrollHeight;
  }
});

settingsBtn.addEventListener('click', () => {
  isSettingsVisible = !isSettingsVisible;
  if (isSettingsVisible) {
    chatLog.classList.add('hidden');
    debugLog.classList.add('hidden');
    settingsView.classList.remove('hidden');
    settingsBtn.style.color = 'var(--text-color)';
    
    isDebugVisible = false;
    debugBtn.style.color = 'var(--text-muted)';
  } else {
    settingsView.classList.add('hidden');
    chatLog.classList.remove('hidden');
    settingsBtn.style.color = 'var(--text-muted)';
    chatLog.scrollTop = chatLog.scrollHeight;
  }
});

// Model dropdown is dynamic now, no toggle needed here.

window.addEventListener('agent-log', (e: any) => {
  const entry = e.detail;
  const div = document.createElement('div');
  div.className = `log-entry ${entry.level}`;
  
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const dataStr = entry.data ? `\n${JSON.stringify(entry.data, null, 2)}` : '';
  
  div.innerHTML = `<span class="log-meta">[${time}] [${entry.level.toUpperCase()}] [${entry.component}]</span> ${entry.message} <pre style="margin:2px 0 0 0;font-size:10px;">${dataStr}</pre>`;
  
  debugLog.appendChild(div);
  
  if (isDebugVisible) {
    debugLog.scrollTop = debugLog.scrollHeight;
  }
});

resetBtn.addEventListener('click', async () => {
  stopAudio();
  chatLog.innerHTML = `
    <div id="welcome-card" class="message agent">
      <div class="message-header">Lucy</div>
      <div class="message-body">
        Hi! I'm Lucy, your voice assistant. Press <strong>Alt+Shift+V</strong> or click the microphone below to start talking.
      </div>
    </div>
  `;
  await agent.clearHistory();
});

const agent = new AgentManager();
const location = await fetchUserLocation();

let selectedModel = 'meta-llama/llama-3.1-8b-instruct';
let rateLimitEnabled = false;
let rateLimitDurationMs = 0;

async function fetchOpenRouterModels() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error('Failed to fetch models');
    const data = await res.json();
    
    llmModelSelect.innerHTML = '';
    
    // Group models by provider (the string before the slash)
    const groups: Record<string, any[]> = {};
    for (const model of data.data) {
      const provider = model.id.split('/')[0];
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(model);
    }
    
    // Sort providers
    const sortedProviders = Object.keys(groups).sort();
    for (const provider of sortedProviders) {
      const optGroup = document.createElement('optgroup');
      optGroup.label = provider.toUpperCase();
      
      // Sort models within provider
      groups[provider].sort((a, b) => a.name.localeCompare(b.name));
      
      for (const model of groups[provider]) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        optGroup.appendChild(option);
      }
      llmModelSelect.appendChild(optGroup);
    }
    
    llmModelSelect.value = selectedModel;
  } catch (err) {
    console.error('Failed to load OpenRouter models:', err);
    llmModelSelect.innerHTML = '<option value="meta-llama/llama-3.1-8b-instruct">Fallback (Llama 3.1 8B)</option>';
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    'selectedModel', 'openRouterApiKey', 'groqApiKey', 'rateLimitEnabled', 'rateLimitDurationMs'
  ]);

  selectedModel = (data.selectedModel as string) || 'meta-llama/llama-3.1-8b-instruct';
  openRouterApiKey = data.openRouterApiKey || import.meta.env.VITE_OPENROUTER_API_KEY || '';
  groqApiKey = data.groqApiKey || import.meta.env.VITE_GROQ_API_KEY || '';
  zaiApiKey = data.zaiApiKey || import.meta.env.VITE_ZAI_API_KEY || '';
  rateLimitEnabled = data.rateLimitEnabled === true;
  rateLimitDurationMs = data.rateLimitDurationMs !== undefined ? (data.rateLimitDurationMs as number) : 0;

  openRouterApiKeyInput.value = openRouterApiKey;
  groqApiKeyInput.value = groqApiKey;
  rateLimitToggle.checked = rateLimitEnabled;
  rateLimitDurationInput.value = rateLimitDurationMs.toString();

  await fetchOpenRouterModels();

  const bgCtx = { name: '', role: '', preferences: [], shortcuts: {}, frequentSites: [], location };
  await agent.configure({ 
    model: selectedModel, groqApiKey, openRouterApiKey, zaiApiKey, rateLimitEnabled, rateLimitDurationMs 
  }, bgCtx);
}

await loadSettings();

saveSettingsBtn.addEventListener('click', async () => {
  selectedModel = llmModelSelect.value;
  openRouterApiKey = openRouterApiKeyInput.value;
  groqApiKey = groqApiKeyInput.value;
  zaiApiKey = import.meta.env.VITE_ZAI_API_KEY || zaiApiKey;
  rateLimitEnabled = rateLimitToggle.checked;
  rateLimitDurationMs = parseInt(rateLimitDurationInput.value, 10) || 0;

  await chrome.storage.local.set({
    selectedModel, openRouterApiKey, groqApiKey, rateLimitEnabled, rateLimitDurationMs
  });

  const bgCtx = { name: '', role: '', preferences: [], shortcuts: {}, frequentSites: [], location };
  await agent.configure({ 
    model: selectedModel, groqApiKey, openRouterApiKey, zaiApiKey, rateLimitEnabled, rateLimitDurationMs 
  }, bgCtx);

  saveStatus.textContent = 'Saved!';
  setTimeout(() => saveStatus.textContent = '', 2000);
});

// Configure Agent Callbacks
agent.onStateChange = (_state: AgentState, message: string) => {
  stateText.textContent = message;
  indicator.dataset.state = _state.toLowerCase();
};

agent.onSpeak = (text: string) => {
  appendLog('Agent', text);
  speakText(text, groqApiKey).catch(console.error);
};

agent.onGetContext = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) throw new Error('No active tab');

  try {
    const ctx = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTEXT' });
    return ctx;
  } catch (err) {
    console.error('Failed to get context from page:', err);
    return { url: tabs[0].url || '', title: tabs[0].title || '', semanticText: '', markersText: '' };
  }
};

agent.onExecuteAction = async (action: any) => {
  const bgActions = ['navigate', 'go_back', 'list_tabs', 'switch_tab', 'close_tab', 'new_tab'];
  if (bgActions.includes(action.action)) {
    return await chrome.runtime.sendMessage({ type: 'EXECUTE_BG_ACTION', action });
  } else {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return false;
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_ACTION', action });
    } catch (err) {
      logger.error('SidePanel', 'Failed to send EXECUTE_ACTION to tab', err);
      return false;
    }
  }
};

chrome.runtime.onMessage.addListener((message: any) => {
  if (message.type === 'HOTKEY_PRESSED') {
    toggleRecording();
  }
});

function appendLog(role: string, text: string) {
  const displayRole = role === 'Agent' ? 'Lucy' : role;
  const div = document.createElement('div');
  div.className = `message ${role.toLowerCase()}`;
  
  const header = document.createElement('div');
  header.className = 'message-header';
  header.textContent = displayRole;
  
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = text;
  
  div.appendChild(header);
  div.appendChild(body);
  
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  stopAudio();
  chrome.runtime.sendMessage({ type: 'MUTE_ALL_TABS' });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      await processAudio(blob);
    };

    mediaRecorder.start();
    isRecording = true;
    indicator.dataset.state = 'listening';
    stateText.textContent = 'Listening...';
  } catch (err: any) {
    console.error(err);
    if (err.name === 'NotAllowedError' || err.message.includes('denied')) {
      stateText.textContent = 'Mic denied. Opening options...';
      chrome.runtime.openOptionsPage();
    } else {
      stateText.textContent = 'Error: Microphone access failed.';
    }
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  chrome.runtime.sendMessage({ type: 'UNMUTE_ALL_TABS' });
  isRecording = false;
  indicator.dataset.state = 'processing';
  stateText.textContent = 'Processing...';
}

async function processAudio(blob: Blob) {
  if (!groqApiKey) {
    stateText.textContent = 'Error: Missing API Key';
    return;
  }

  try {
    stateText.textContent = 'Transcribing...';
    const transcript = await transcribeAudio(blob, groqApiKey);
    
    if (isSilenceHallucination(transcript)) {
      stateText.textContent = 'Idle (Ignored silence)';
      return;
    }

    appendLog('User', transcript);
    await agent.handleTranscript(transcript);
  } catch (err) {
    console.error('Transcription failed:', err);
    stateText.textContent = 'Error processing audio';
  }
}

setTimeout(async () => {
  if (!openRouterApiKey) return;
  try {
    const ctx = await agent.onGetContext?.();
    if (!ctx || !ctx.url || ctx.url.startsWith('chrome://')) return;
    const sysPrompt = "You are Voice Agent, a helpful browser assistant. The user just opened your panel. Say a very short, friendly greeting (1 sentence) acknowledging what website they are currently looking at. Do not ask how you can help, just say hi and acknowledge the page.";
    const llmMessages: any = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: `Current URL: ${ctx.url}\nPage Title: ${ctx.title}` }
    ];
    const config = { model: selectedModel, openRouterApiKey, groqApiKey, rateLimitEnabled, rateLimitDurationMs };
    const greeting = await callLLM(llmMessages, config, selectedModel, false);
    if (greeting) {
      agent.onSpeak?.(greeting);
    }
  } catch (err) {
    console.error('Failed to generate greeting', err);
  }
}, 1000);
