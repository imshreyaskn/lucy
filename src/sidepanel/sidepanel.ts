// src/sidepanel/sidepanel.ts
import { AgentManager } from '../lib/agent-manager';
import type { StateSnapshot } from '../lib/agent-manager';
import { logger } from '../lib/logger';
import { speakText, stopAudio } from '../lib/speaker';
import { callGemini } from '../lib/litellm-client';
import { fetchUserLocation } from '../lib/ip-location';
import SiriWave from 'siriwave';

let isRecording = false;
let recognition: any = null;
let geminiModel = 'gemini-3.1-flash-lite';
let geminiApiKey = '';
let groqApiKey = '';
let visionEnabled = true;

const indicator = document.getElementById('mic-indicator')!;
const stateText = document.getElementById('agent-state')!;
const chatLog = document.getElementById('chat-log')!;
const debugLog = document.getElementById('debug-log')!;
const resetBtn = document.getElementById('reset-btn')!;
const debugBtn = document.getElementById('debug-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsView = document.getElementById('settings-view')!;

let siriWave: any = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];

setTimeout(() => {
  siriWave = new SiriWave({
    container: document.getElementById('siri-wave-mount')!,
    width: 70,
    height: 90,
    style: 'ios9',
    speed: 0.08,
    amplitude: 0.5,
    frequency: 6,
    color: '#ffffff', // Clean white wave inside the colorful mesh
    autostart: true
  });
}, 100);

let waveTargetAmp = 0.5;
let waveTargetSpeed = 0.08;
let currentScale = 1; // ponytail: lerp scale in JS so it doesn't jitter the CSS transition

const waveLoop = () => {
  if (siriWave) {
    const state = indicator.dataset.state || 'idle';
    let targetScale = 1;
    
    if (state === 'idle') {
      waveTargetAmp = 0.5;
      waveTargetSpeed = 0.08;
      targetScale = 1;
    } else if (state === 'listening' && analyser) {
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const volumeLevel = (sum / dataArray.length) / 255;
      
      const rawAmp = volumeLevel > 0.01 ? volumeLevel * 15 : 0.5;
      waveTargetAmp = Math.min(rawAmp, 5); // ponytail: cap amplitude so it doesn't blow out
      
      const rawSpeed = volumeLevel > 0.05 ? volumeLevel * 8 : 0.15;
      waveTargetSpeed = Math.min(rawSpeed, 2);
      
      const rawScale = 1 + (volumeLevel * 0.2);
      targetScale = Math.min(rawScale, 1.2); // ponytail: cap scale expansion
    } else {
      // Responding / Processing
      const time = Date.now() / 300;
      const simVol = 0.5 + Math.sin(time) * 0.3; // 0.2 to 0.8
      waveTargetAmp = simVol * 4;
      waveTargetSpeed = simVol * 3;
      targetScale = 1 + (simVol * 0.1); // Orb pulses softer when responding
    }
    
    currentScale += (targetScale - currentScale) * 0.1; // Smooth scale transitions
    indicator.style.transform = `scale(${currentScale})`;
    
    siriWave.setAmplitude(siriWave.amplitude + (waveTargetAmp - siriWave.amplitude) * 0.1); // Smoother lerp
    siriWave.setSpeed(siriWave.speed + (waveTargetSpeed - siriWave.speed) * 0.1);
  }
  requestAnimationFrame(waveLoop);
};
requestAnimationFrame(waveLoop);

const geminiModelSelect = document.getElementById('gemini-model') as HTMLSelectElement;
const geminiApiKeyInput = document.getElementById('gemini-api-key') as HTMLInputElement;
const groqApiKeyInput = document.getElementById('groq-api-key') as HTMLInputElement;
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

document.getElementById('close-settings-btn')?.addEventListener('click', () => {
  isSettingsVisible = false;
  settingsView.classList.remove('active');
  settingsBtn.style.color = 'var(--text-muted)';
  chatLog.scrollTop = chatLog.scrollHeight;
});

document.getElementById('close-debug-btn')?.addEventListener('click', () => {
  isDebugVisible = false;
  debugLog.classList.remove('active');
  debugBtn.style.color = 'var(--text-muted)';
  chatLog.scrollTop = chatLog.scrollHeight;
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
    'geminiModel', 'geminiApiKey', 'groqApiKey', 'visionEnabled', 'rateLimitEnabled', 'rateLimitDurationMs'
  ]);

  geminiModel = (data.geminiModel as string) || 'gemini-3.1-flash-lite';
  geminiApiKey = (data.geminiApiKey as string) || '';
  groqApiKey = (data.groqApiKey as string) || '';
  visionEnabled = data.visionEnabled !== false;
  rateLimitEnabled = data.rateLimitEnabled === true;
  rateLimitDurationMs = data.rateLimitDurationMs !== undefined ? (data.rateLimitDurationMs as number) : 0;

  geminiModelSelect.value = geminiModel;
  geminiApiKeyInput.value = geminiApiKey;
  groqApiKeyInput.value = groqApiKey;
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
  groqApiKey = groqApiKeyInput.value;
  visionEnabled = visionToggle.checked;
  rateLimitEnabled = rateLimitToggle.checked;
  rateLimitDurationMs = parseInt(rateLimitDurationInput.value, 10) || 0;

  await chrome.storage.local.set({
    geminiModel, geminiApiKey, groqApiKey, visionEnabled, rateLimitEnabled, rateLimitDurationMs
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

let isRefreshingTab = false;

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
        if (!isRefreshingTab) {
          isRefreshingTab = true;
          agent.onSpeak?.('I lost connection to the page. I am refreshing it for you now.');
          chrome.tabs.reload(tabId);
          setTimeout(() => isRefreshingTab = false, 8000);
        }
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

    recognition.onstart = async () => {
      logger.info('STT', 'Speech recognition started');
      isRecording = true;
      interimBubble = null;
      indicator.dataset.state = 'listening';
      stateText.textContent = 'Listening...';
      
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(analyser);
        
        if (groqApiKey) {
          mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
          audioChunks = [];
          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
          };
          mediaRecorder.start();
        }
      } catch (err) {
        console.error("Failed to start audio analyzer", err);
      }
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
        
        indicator.dataset.state = 'processing';
        stateText.textContent = 'Processing...';

        if (groqApiKey && mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            const formData = new FormData();
            formData.append('file', blob, 'audio.webm');
            formData.append('model', 'whisper-large-v3-turbo');
            formData.append('language', 'en'); // ponytail: explicitly force English to prevent accent hallucination

            try {
              stateText.textContent = 'Transcribing...';
              const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${groqApiKey}` },
                body: formData
              });
              if (!res.ok) throw new Error(`Groq API Error: ${res.status}`);
              const json = await res.json();
              const groqText = json.text?.trim() || finalTranscript;
              appendLog('User', groqText);
              await agent.handleTranscript(groqText);
            } catch (err) {
              console.error('Groq fallback to Webkit:', err);
              appendLog('User', finalTranscript);
              await agent.handleTranscript(finalTranscript);
            }
          };
          stopRecording(); // Triggers mediaRecorder.onstop
        } else {
          appendLog('User', finalTranscript);
          stopRecording();
          await agent.handleTranscript(finalTranscript);
        }
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
  
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  indicator.style.transform = '';
  
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
