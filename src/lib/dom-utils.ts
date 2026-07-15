// src/lib/dom-utils.ts

export function isVisible(el: Element, checkViewport = false): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  
  if (checkViewport) {
    const buffer = 500;
    if (rect.bottom < -buffer || rect.top > window.innerHeight + buffer) return false;
    if (rect.right < -buffer || rect.left > window.innerWidth + buffer) return false;
  }

  const style = window.getComputedStyle(el);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0' ||
    el.getAttribute('aria-hidden') === 'true'
  ) return false;
  return true;
}

export function getLabel(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const labelEl = document.getElementById(ariaLabelledBy);
    if (labelEl && labelEl.textContent) return labelEl.textContent.trim();
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return el.placeholder;
  }

  const title = el.getAttribute('title');
  if (title) return title;

  let text = (el as HTMLElement).innerText || el.textContent || '';
  text = text.trim().replace(/\s+/g, ' ');
  if (text.length > 60) text = text.substring(0, 57) + '...';
  return text;
}

export function fillInput(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.focus();
  element.select();
  
  // ponytail: force Monaco/CodeMirror to select all existing boilerplate so it gets overwritten
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', metaKey: true, bubbles: true }));
  document.execCommand('selectAll', false, undefined);
  
  // Try execCommand first for realistic keystrokes
  const success = document.execCommand('insertText', false, value);
  
  if (!success) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element), 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

export function waitForDomSettle(maxWait = 2000): Promise<void> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { observer.disconnect(); resolve(); }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(); }, maxWait);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
