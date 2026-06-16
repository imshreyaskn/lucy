// src/lib/markers.ts
import { isVisible, getLabel } from './dom-utils';

export interface Marker {
  id: number;
  element: Element;
  role: string;
  label: string;
  type?: string;
  href?: string;
  disabled: boolean;
  checked?: boolean;
  quadrant?: string;
}

export function collectInteractives(
  root: Element | ShadowRoot | Document = document,
  markers: Marker[] = [],
  counter = { n: 0 }
): Marker[] {
  const TARGETS = 'button, a[href], input, select, textarea, video, audio, ' +
    '[role=button], [role=link], [role=menuitem], [role=tab], ' +
    '[role=checkbox], [role=radio], [contenteditable=true]';

  const rootElement = root instanceof Document ? root.documentElement : root as Element;

  rootElement.querySelectorAll('*').forEach(el => {
    // 1. Check for shadow roots
    if (el.shadowRoot) collectInteractives(el.shadowRoot, markers, counter);

    // 2. Check for iframes
    if (el.tagName.toLowerCase() === 'iframe') {
      const iframe = el as HTMLIFrameElement;
      if (isVisible(iframe, true)) {
        try {
          if (iframe.contentWindow && iframe.contentDocument) {
            collectInteractives(iframe.contentDocument, markers, counter);
          }
        } catch (e) {
          counter.n++;
          markers.push({
            id: counter.n,
            element: iframe,
            role: 'iframe',
            label: `[Cross-Origin Iframe: ${iframe.src || 'unknown'}]`,
            disabled: false,
            quadrant: 'Center'
          });
        }
      }
    }

    // 3. Check if it's an interactive target
    if (el.matches(TARGETS)) {
      if (!isVisible(el, true) || (el as HTMLButtonElement).disabled) return;
      
      const href = el instanceof HTMLAnchorElement ? el.href : undefined;
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const label = getLabel(el);
      
      // Deduplication logic
      const isDuplicate = markers.some(m => {
        if (href && m.href === href) return true;
        if (!href && m.label === label && m.role === role) return true;
        return false;
      });

      if (isDuplicate) return;

      counter.n++;
      (el as HTMLElement).dataset.agentMarker = String(counter.n);
      
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      
      let quadrant = '';
      if (y < window.innerHeight / 3) quadrant += 'Top';
      else if (y < (window.innerHeight * 2) / 3) quadrant += 'Center';
      else quadrant += 'Bottom';
      
      if (x < window.innerWidth / 3) quadrant += (quadrant === 'Center' ? ' Left' : ' Left');
      else if (x > (window.innerWidth * 2) / 3) quadrant += (quadrant === 'Center' ? ' Right' : ' Right');
      
      markers.push({
        id: counter.n,
        element: el,
        role,
        label,
        type: el instanceof HTMLInputElement ? el.type : undefined,
        href,
        disabled: false,
        quadrant
      });
    }
  });

  return markers;
}

export function formatMarkersText(markers: Marker[]): string {
  return markers.map(m => {
    let text = `[${m.id}] ${m.role}`;
    if (m.type) text += ` (${m.type})`;
    text += ` [${m.quadrant}] — "${m.label}"`;
    if (m.href) {
      let h = m.href;
      if (h.length > 40) h = h.substring(0, 37) + '...';
      text += ` → ${h}`;
    }
    return text;
  }).join('\n');
}
