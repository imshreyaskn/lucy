// src/lib/groq-tts.ts

export async function groqTTS(text: string, apiKey: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'canopylabs/orpheus-v1-english',
        voice: 'tara',
        input: text,
        response_format: 'wav'
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`TTS error: ${res.status}`);
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timeoutId);
  }
}

export function browserTTS(text: string): Promise<void> {
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    
    // Attempt to pick a premium natural female voice to match the original Lucy persona (Aoede)
    const preferredVoice = voices.find(v => v.name.includes('Google US English')) || 
                           voices.find(v => v.name.includes('Natural') && v.name.includes('Female')) ||
                           voices.find(v => v.name.includes('Microsoft Zira'));
                           
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
    
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.1; // slightly higher pitch for a warmer female tone
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve(); // continue even if error
    speechSynthesis.speak(utterance);
  });
}

let currentAudio: HTMLAudioElement | null = null;
let audioQueue: (() => Promise<void>)[] = [];
let isPlaying = false;

export function stopAudio() {
  audioQueue = []; // Clear queue
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    if (currentAudio.src && currentAudio.src.startsWith('blob:')) {
      URL.revokeObjectURL(currentAudio.src);
    }
    currentAudio = null;
  }
  speechSynthesis.cancel();
  isPlaying = false;
}

export async function speakText(text: string, apiKey?: string): Promise<void> {
  return new Promise((resolve) => {
    audioQueue.push(async () => {
      isPlaying = true;
      try {
        if (!apiKey) {
          await browserTTS(text);
        } else {
          try {
            const buffer = await groqTTS(text, apiKey);
            const blob = new Blob([buffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            currentAudio = new Audio(url);
            await new Promise<void>((res) => {
              if (!currentAudio) return res(); // was stopped
              currentAudio.onended = () => res();
              currentAudio.onerror = () => res();
              currentAudio.play().catch(() => res());
            });
            URL.revokeObjectURL(url);
            currentAudio = null;
          } catch (err) {
            console.warn('Groq TTS failed, falling back to browser TTS:', err);
            await browserTTS(text);
          }
        }
      } finally {
        isPlaying = false;
        resolve();
        processQueue();
      }
    });
    
    if (!isPlaying) {
      processQueue();
    }
  });
}

function processQueue() {
  if (audioQueue.length > 0 && !isPlaying) {
    const next = audioQueue.shift();
    if (next) next();
  }
}
