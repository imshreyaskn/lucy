// src/lib/groq-stt.ts

export async function transcribeAudio(blob: Blob, apiKey: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob, 'audio.webm');
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'text');
  formData.append('language', 'en');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`STT error: ${res.status}`);
    }

    const text = await res.text();
    return text.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

const HALLUCINATION_PATTERNS = [
  /^thank you\.?$/i,
  /^\.\.\.*$/,
  /^$/, // empty string
];

export function isSilenceHallucination(transcript: string): boolean {
  const trimmed = transcript.trim();
  if (!trimmed) return true;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 1 || HALLUCINATION_PATTERNS.some(p => p.test(trimmed))) {
    return true;
  }
  return false;
}
