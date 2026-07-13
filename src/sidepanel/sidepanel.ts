// src/sidepanel/sidepanel.ts
import { AgentManager } from '../lib/agent-manager';
import type { StateSnapshot } from '../lib/agent-manager';
import { logger } from '../lib/logger';
import { speakText, stopAudio } from '../lib/speaker';
import { callGemini } from '../lib/litellm-client';
import { fetchUserLocation } from '../lib/ip-location';

let isRecording = false;
let recognition: any = null;
let geminiModel = 'gemini-3.1-flash-lite';
let geminiApiKey = '';
let visionEnabled = true;

const indicator = document.getElementById('mic-indicator')!;
const stateText = document.getElementById('agent-state')!;
const chatLog = document.getElementById('chat-log')!;
const debugLog = document.getElementById('debug-log')!;
const resetBtn = document.getElementById('reset-btn')!;
const debugBtn = document.getElementById('debug-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsView = document.getElementById('settings-view')!;

const geminiModelSelect = document.getElementById('gemini-model') as HTMLSelectElement;
const geminiApiKeyInput = document.getElementById('gemini-api-key') as HTMLInputElement;
const visionToggle = document.getElementById('vision-toggle') as HTMLInputElement;
const rateLimitToggle = document.getElementById('rate-limit-toggle') as HTMLInputElement;
const rateLimitDurationInput = document.getElementById('rate-limit-duration') as HTMLInputElement;
const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement;
const exportDataBtn = document.getElementById('export-data-btn') as HTMLButtonElement;
const saveStatus = document.getElementById('save-status')!;

let isDebugVisible = false;
let isSettingsVisible = false;

debugBtn.addEventListener('click', () => {
  isDebugVisible = !isDebugVisible;
  if (isDebugVisible) {
    debugLog.classList.add('active');
    debugBtn.style.color = 'var(--text-color)';
    debugLog.scrollTop = debugLog.scrollHeight;
    
    isSettingsVisible = false;
    settingsView.classList.remove('active');
    settingsBtn.style.color = 'var(--text-muted)';
  } else {
    debugLog.classList.remove('active');
    debugBtn.style.color = 'var(--text-muted)';
    chatLog.scrollTop = chatLog.scrollHeight;
  }
});

settingsBtn.addEventListener('click', () => {
  isSettingsVisible = !isSettingsVisible;
  if (isSettingsVisible) {
    settingsView.classList.add('active');
    settingsBtn.style.color = 'var(--text-color)';
    
    setTimeout(() => geminiModelSelect.focus(), 100);
    
    isDebugVisible = false;
    debugLog.classList.remove('active');
    debugBtn.style.color = 'var(--text-muted)';
  } else {
    settingsView.classList.remove('active');
    settingsBtn.style.color = 'var(--text-muted)';
    chatLog.scrollTop = chatLog.scrollHeight;
  }
});

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
        Hi! I'm Lucy, your voice assistant. Press <strong>Ctrl+Space</strong> or click the microphone below to start talking.
      </div>
    </div>
  `;
  await agent.clearHistory();
});

const agent = new AgentManager();
const location = await fetchUserLocation();

let rateLimitEnabled = false;
let rateLimitDurationMs = 0;

async function loadSettings() {
  const data = await chrome.storage.local.get([
    'geminiModel', 'geminiApiKey', 'visionEnabled', 'rateLimitEnabled', 'rateLimitDurationMs'
  ]);

  geminiModel = (data.geminiModel as string) || 'gemini-3.1-flash-lite';
  geminiApiKey = (data.geminiApiKey as string) || '';
  visionEnabled = data.visionEnabled !== false;
  rateLimitEnabled = data.rateLimitEnabled === true;
  rateLimitDurationMs = data.rateLimitDurationMs !== undefined ? (data.rateLimitDurationMs as number) : 0;

  geminiModelSelect.value = geminiModel;
  geminiApiKeyInput.value = geminiApiKey;
  visionToggle.checked = visionEnabled;
  rateLimitToggle.checked = rateLimitEnabled;
  rateLimitDurationInput.value = rateLimitDurationMs.toString();

  const bgCtx = { name: '', role: '', preferences: [], shortcuts: {}, frequentSites: [], location };
  await agent.configure({ 
    geminiModel, geminiApiKey, visionEnabled, rateLimitEnabled, rateLimitDurationMs 
  }, bgCtx);
}

await loadSettings();

saveSettingsBtn.addEventListener('click', async () => {
  geminiModel = geminiModelSelect.value;
  geminiApiKey = geminiApiKeyInput.value;
  visionEnabled = visionToggle.checked;
  rateLimitEnabled = rateLimitToggle.checked;
  rateLimitDurationMs = parseInt(rateLimitDurationInput.value, 10) || 0;

  await chrome.storage.local.set({
    geminiModel, geminiApiKey, visionEnabled, rateLimitEnabled, rateLimitDurationMs
  });

  const bgCtx = { name: '', role: '', preferences: [], shortcuts: {}, frequentSites: [], location };
  await agent.configure({ 
    geminiModel, geminiApiKey, visionEnabled, rateLimitEnabled, rateLimitDurationMs 
  }, bgCtx);

  saveStatus.textContent = 'Saved!';
  setTimeout(() => saveStatus.textContent = '', 2000);
});

exportDataBtn.addEventListener('click', async () => {
  const localData = await chrome.storage.local.get(null);
  const sessionData = await chrome.storage.session.get(null);
  
  const payload = {
    settings: {
      geminiModel: localData.geminiModel,
      visionEnabled: localData.visionEnabled,
      rateLimitEnabled: localData.rateLimitEnabled,
      rateLimitDurationMs: localData.rateLimitDurationMs
    },
    longTermMemories: localData.longTermMemories || [],
    chatHistory: sessionData.chatHistory || []
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `lucy-data-export-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
});

// Configure Agent Callbacks
agent.onStateChange = (snap: StateSnapshot) => {
  let statusText = snap.message;
  if (snap.waitReason) statusText += ` (${snap.waitReason})`;
  if (snap.stepCount > 0) statusText += ` [Step ${snap.stepCount}]`;
  if (snap.consecutiveFailures > 0) statusText += ` (Failures: ${snap.consecutiveFailures})`;
  
  stateText.textContent = statusText;
  indicator.dataset.state = snap.state.toLowerCase();
};

agent.onSpeak = (text: string) => {
  appendLog('Agent', text);
  speakText(text).catch(console.error);
};

agent.onGetContext = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) throw new Error('No active tab');

  try {
    const ctx = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTEXT' });
    return ctx;
  } catch (err: any) {
    console.error('Failed to get context from page:', err);
    const url = tabs[0].url || '';
    if (err.message && err.message.includes('Receiving end does not exist')) {
      if (!url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('about:')) {
        agent.onSpeak?.('I lost connection to the page. I am refreshing it for you now.');
        chrome.tabs.reload(tabId);
      }
    }
    return { url, title: tabs[0].title || '', semanticText: '', markersText: '' };
  }
};

agent.onGetScreenshot = async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const windowId = tabs[0]?.windowId;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 50 });
    return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  } catch (err) {
    console.warn('Screenshot capture failed:', err);
    return null;
  }
};

agent.onExecuteAction = async (action: any) => {
  let actionText = '';
  switch (action.action) {
    case 'navigate': actionText = `Navigating to ${action.url}`; break;
    case 'click': actionText = `Clicking element`; break;
    case 'type': actionText = `Typing "${action.text}"`; break;
    case 'scroll': actionText = `Scrolling page`; break;
    case 'wait': actionText = `Waiting...`; break;
    case 'go_back': actionText = `Going back`; break;
    case 'switch_tab': actionText = `Switching tab`; break;
    case 'close_tab': actionText = `Closing tab`; break;
    default: actionText = `Executing: ${action.action}`; break;
  }
  appendLog('Action', actionText);

  if (action.action === 'wait') {
    await new Promise(resolve => setTimeout(resolve, 3000));
    return true;
  }

  const bgActions = ['navigate', 'go_back', 'list_tabs', 'switch_tab', 'close_tab', 'new_tab'];
  if (bgActions.includes(action.action)) {
    return await chrome.runtime.sendMessage({ type: 'EXECUTE_BG_ACTION', action });
  } else {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return false;
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_ACTION', action });
    } catch (err: any) {
      logger.error('SidePanel', 'Failed to send EXECUTE_ACTION to tab', err);
      const url = tabs[0].url || '';
      if (err.message && err.message.includes('Receiving end does not exist')) {
        if (!url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('about:')) {
          agent.onSpeak?.('I lost connection to the page. I am refreshing it for you now.');
          chrome.tabs.reload(tabId);
        }
      }
      return false;
    }
  }
};

chrome.runtime.onMessage.addListener((message: any) => {
  if (message.type === 'HOTKEY_PRESSED') {
    toggleRecording();
  }
});

function appendLog(role: string, text: string, isInterim = false) {
  const displayRole = role === 'Agent' ? 'Lucy' : (role === 'Action' ? '' : role);
  const div = document.createElement('div');
  
  if (role === 'Action') {
    div.className = 'message action';
    div.innerHTML = `<div class="message-body"><i>${text}</i></div>`;
  } else {
    div.className = `message ${role.toLowerCase()} ${isInterim ? 'interim' : ''}`;
    
    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = displayRole;
    
    const body = document.createElement('div');
    body.className = 'message-body';
    body.textContent = text;
    
    div.appendChild(header);
    div.appendChild(body);
  }
  
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

async function toggleRecording() {
  if (isRecording) {
    stopRecording();
    return;
  }

  if (!('webkitSpeechRecognition' in window)) {
    stateText.textContent = 'Error: Speech Recognition API not supported.';
    return;
  }

  try {
    logger.info('STT', 'Initializing native webkitSpeechRecognition');
    recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let interimBubble: HTMLElement | null = null;

    recognition.onstart = () => {
      logger.info('STT', 'Speech recognition started');
      isRecording = true;
      interimBubble = null;
      indicator.dataset.state = 'listening';
      stateText.textContent = 'Listening...';
    };

    recognition.onresult = async (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (interimTranscript) {
        if (!interimBubble) {
           interimBubble = appendLog('User', interimTranscript, true);
        } else {
           const body = interimBubble.querySelector('.message-body');
           if (body) body.textContent = interimTranscript;
           chatLog.scrollTop = chatLog.scrollHeight;
        }
      }

      if (finalTranscript) {
        if (interimBubble) {
          interimBubble.remove();
          interimBubble = null;
        }
        
        logger.debug('STT', 'Speech recognition result received', { transcript: finalTranscript });
        if (!finalTranscript.trim()) return;
        appendLog('User', finalTranscript);
        
        indicator.dataset.state = 'processing';
        stateText.textContent = 'Processing...';
        
        await agent.handleTranscript(finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech') {
        logger.error('STT', 'Speech recognition error', event.error);
        console.error('Speech recognition error', event.error);
      }
      
      if (event.error === 'not-allowed') {
        stateText.textContent = 'Mic denied. Opening options...';
        chrome.runtime.openOptionsPage();
      } else if (event.error === 'no-speech') {
        // Just silently ignore no-speech and let onend handle the cleanup
      } else {
        stateText.textContent = `Error: ${event.error}`;
      }
      stopRecording();
    };

    recognition.onend = () => {
      logger.debug('STT', 'Speech recognition ended');
      if (isRecording) {
         stopRecording();
      }
    };

    recognition.start();
  } catch (err: any) {
    logger.error('STT', 'Microphone access failed', err);
    console.error(err);
    stateText.textContent = 'Error: Microphone access failed.';
  }
}

function stopRecording() {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  chrome.runtime.sendMessage({ type: 'UNMUTE_ALL_TABS' });
  isRecording = false;
  
  if (indicator.dataset.state === 'listening') {
    indicator.dataset.state = 'idle';
    stateText.textContent = 'Idle (Ctrl+Space)';
  }
}

setTimeout(async () => {
  try {
    const ctx = await agent.onGetContext?.();
    if (!ctx || !ctx.url || ctx.url.startsWith('chrome://')) return;
    const sysPrompt = "You are Voice Agent, a helpful browser assistant. The user just opened your panel. Say a very short, friendly greeting (1 sentence) acknowledging what website they are currently looking at. Do not ask how you can help, just say hi and acknowledge the page.";
    const llmMessages: any = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: `Current URL: ${ctx.url}\nPage Title: ${ctx.title}` }
    ];
    const greeting = await callGemini(llmMessages, { geminiModel, geminiApiKey, rateLimitEnabled, rateLimitDurationMs, visionEnabled }, false);
    if (greeting) {
      agent.onSpeak?.(greeting);
    }
  } catch (err) {
    console.error('Failed to generate greeting', err);
  }
}, 1000);
