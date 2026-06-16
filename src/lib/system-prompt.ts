// src/lib/system-prompt.ts

export interface BackgroundContext {
  name: string;
  role: string;
  preferences: string[];
  shortcuts: Record<string, string>;
  frequentSites: string[];
  location?: any;
}

export function buildBgCtxSummary(bgCtx: BackgroundContext | null): string {
  if (!bgCtx) return '';
  let s = `\nBackground Context about the user:`;
  if (bgCtx.name) s += `\nName: ${bgCtx.name}`;
  if (bgCtx.role) s += `\nRole: ${bgCtx.role}`;
  if (bgCtx.preferences && bgCtx.preferences.length > 0) s += `\nPreferences: ${bgCtx.preferences.join(', ')}`;
  if (bgCtx.shortcuts && Object.keys(bgCtx.shortcuts).length > 0) s += `\nShortcuts: ${JSON.stringify(bgCtx.shortcuts)}`;
  if (bgCtx.frequentSites && bgCtx.frequentSites.length > 0) s += `\nFrequent Sites: ${bgCtx.frequentSites.join(', ')}`;
  if (bgCtx.location) s += `\nLocation: ${bgCtx.location.city}, ${bgCtx.location.region}, ${bgCtx.location.country_name} (Timezone: ${bgCtx.location.timezone})`;
  return s + '\n';
}

export function buildFullSystemPrompt(bgCtx: BackgroundContext | null): string {
  let prompt = `You are Voice Agent, an AI browser assistant designed for blind and visually impaired users.
You control the user's browser via an extension. You must be helpful, concise, and safe.
Do not use markdown formatting in your spoken responses because they will be read aloud via TTS.

When you respond, speak directly to the user in a natural, conversational tone.
`;

  if (bgCtx) {
    prompt += buildBgCtxSummary(bgCtx);
  }

  return prompt;
}
