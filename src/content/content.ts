// src/content/content.ts
import { collectInteractives, formatMarkersText } from '../lib/markers';
import { getPageMetadata, extractSemanticText } from '../lib/page-context';
import { detectOverlay, dismissOverlay } from '../lib/overlay-handler';
import { fillInput, sleep, waitForDomSettle } from '../lib/dom-utils';

console.log('[Voice Agent] Content script loaded');

chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'GET_CONTEXT') {
    handleGetContext().then(sendResponse);
    return true; // async
  }
  
  if (message.type === 'EXECUTE_ACTION') {
    handleExecuteAction(message.action).then(sendResponse);
    return true; // async
  }
});

async function handleGetContext() {
  // 1. Handle Overlays
  const overlay = detectOverlay();
  if (overlay) {
    await dismissOverlay();
  }

  // 2. Extract Data
  const meta = getPageMetadata();
  const semanticText = extractSemanticText();
  const markers = collectInteractives();
  const markersText = formatMarkersText(markers);

  return {
    url: meta.url,
    title: meta.title,
    semanticText,
    markersText
  };
}

async function handleExecuteAction(action: any): Promise<boolean> {
  console.log('[Voice Agent] Executing action:', action);
  
  try {
    if (action.action === 'click') {
      const el = document.querySelector(`[data-agent-marker="${action.target_id}"]`) as HTMLElement;
      if (!el) return false;

      if (el instanceof HTMLMediaElement) {
        if (el.paused) el.play();
        else el.pause();
        return true;
      }

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300);
      el.focus();
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
        el.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true, view: window }));
      });
      try { el.click(); } catch(e) {}
      return true;
    }
    
    if (action.action === 'type') {
      const el = document.querySelector(`[data-agent-marker="${action.target_id}"]`) as HTMLElement;
      if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300);
      el.focus();
      fillInput(el, action.text || '');
      await sleep(300);
      if (action.submit) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        const form = el.closest('form');
        if (form) {
          try { form.requestSubmit(); } catch (e) { form.submit(); }
        }
      }
      return true;
    }

    if (action.action === 'press_key' && action.text) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: action.text, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keypress', { key: action.text, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: action.text, bubbles: true }));
      return true;
    }

    if (action.action === 'media' && action.text) {
      const mediaElements = Array.from(document.querySelectorAll('video, audio')) as HTMLMediaElement[];
      if (mediaElements.length === 0) return false;
      
      for (const media of mediaElements) {
        if (action.text === 'play') media.play().catch(() => {});
        else if (action.text === 'pause') media.pause();
        else if (action.text === 'mute') media.muted = true;
        else if (action.text === 'unmute') media.muted = false;
      }
      return true;
    }

    if (action.action === 'press_enter') {
      const el = document.activeElement as HTMLElement;
      if (el) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        // Also try to submit form if it exists
        const form = el.closest('form');
        if (form) form.requestSubmit();
        await sleep(500);
        return true;
      }
      return false;
    }
    
    if (action.action === 'scroll_down' || action.action === 'scroll_up' || action.action === 'scroll') {
      let multiplier = 0.8; // Default large scroll
      if (action.text === 'small') multiplier = 0.2;
      else if (action.text === 'medium') multiplier = 0.5;

      const sign = (action.action === 'scroll_up') ? -1 : 1;
      window.scrollBy({ top: window.innerHeight * multiplier * sign, behavior: 'smooth' });
      await sleep(500);
      return true;
    }

    if (action.action === 'navigate' || action.action === 'go_back' || action.action === 'switch_tab') {
      return false; // handled by background script
    }

    if (action.action === 'wait') {
      await sleep(3000);
      return true;
    }
    
    await waitForDomSettle(1500);
    return false; // navigate and go_back handled by background script
  } catch (err) {
    console.error('[Voice Agent] Action failed:', err);
    return false;
  }
}
