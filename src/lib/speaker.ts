// src/lib/speaker.ts
import { logger } from './logger';

export function browserTTS(text: string): Promise<void> {
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Sometimes voices take a moment to load in Chrome on first run.
    let voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      const handleVoices = () => {
        speechSynthesis.removeEventListener('voiceschanged', handleVoices);
        voices = speechSynthesis.getVoices();
        executeSpeech(utterance, voices, resolve);
      };
      speechSynthesis.addEventListener('voiceschanged', handleVoices);
    } else {
      executeSpeech(utterance, voices, resolve);
    }
  });
}

function executeSpeech(utterance: SpeechSynthesisUtterance, voices: SpeechSynthesisVoice[], resolve: (value: void | PromiseLike<void>) => void) {
    // Attempt to pick a premium natural female voice to match the original Lucy persona (Aoede)
    const preferredVoice = voices.find(v => v.name.includes('Google US English')) || 
                           voices.find(v => v.name.includes('Natural') && v.name.includes('Female')) ||
                           voices.find(v => v.name.includes('Microsoft Zira'));
                           
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      logger.debug('TTS', `Selected voice: ${preferredVoice.name}`);
    } else {
      logger.debug('TTS', 'No preferred voice found, using default');
    }
    
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => {
      logger.info('TTS', 'Speech synthesis ended');
      resolve();
    };
    utterance.onerror = (e) => {
      logger.error('TTS', 'Speech synthesis error', e);
      resolve(); // continue even if error
    };
    
    logger.info('TTS', 'Starting native browser speech synthesis');
    speechSynthesis.speak(utterance);
}

let audioQueue: (() => Promise<void>)[] = [];
let isPlaying = false;

export function stopAudio() {
  audioQueue = []; // Clear queue
  speechSynthesis.cancel();
  isPlaying = false;
  logger.info('TTS', 'Audio playback stopped and queue cleared');
}

export async function speakText(text: string): Promise<void> {
  return new Promise((resolve) => {
    audioQueue.push(async () => {
      isPlaying = true;
      try {
        await browserTTS(text);
      } catch (err) {
        logger.error('TTS', 'Browser TTS failed', err);
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
