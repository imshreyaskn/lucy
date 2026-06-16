// src/lib/overlay-handler.ts
import { isVisible, sleep } from './dom-utils';

const OVERLAY_SELECTORS = [
  '[role=dialog]', '[role=alertdialog]',
  '.modal', '.popup', '.overlay', '.cookie-banner',
  '[class*="modal"]', '[class*="dialog"]', '[class*="cookie"]',
  '[class*="consent"]', '[class*="gdpr"]', '[class*="notification"]'
];

export function detectOverlay(): Element | null {
  for (const sel of OVERLAY_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) return el;
  }
  return null;
}

export async function dismissOverlay(): Promise<boolean> {
  // Strategy 1: Press Escape
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(300);
  if (!detectOverlay()) return true;

  // Strategy 2: Click close button by common patterns
  const closeTexts = ['Close', 'Dismiss', 'No thanks', 'Accept', 'Got it'];
  const closeSelectors = [
    '[aria-label="Close"]', '[aria-label="Dismiss"]',
    '.close-btn', '.btn-close', '[class*="close"]'
  ];
  
  for (const sel of closeSelectors) {
    const btn = document.querySelector(sel) as HTMLElement;
    if (btn && isVisible(btn)) {
      btn.click();
      await sleep(300);
      if (!detectOverlay()) return true;
    }
  }

  // Fallback to text matching
  const allBtns = Array.from(document.querySelectorAll('button'));
  for (const btn of allBtns) {
    if (closeTexts.some(t => btn.textContent?.includes(t)) && isVisible(btn)) {
      btn.click();
      await sleep(300);
      if (!detectOverlay()) return true;
    }
  }

  if (!detectOverlay()) return true;

  // Strategy 3: Click backdrop
  const overlay = detectOverlay();
  if (overlay) {
    document.elementFromPoint(5, 5)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  await sleep(300);
  return !detectOverlay();
}
