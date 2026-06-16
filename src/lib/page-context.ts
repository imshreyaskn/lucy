// src/lib/page-context.ts
import { isVisible } from './dom-utils';

export interface PageMetadata {
  url: string;
  title: string;
  scrollPercent: number;
  viewportHeight: number;
  viewportWidth: number;
  focusedElement: string;
}

export function getPageMetadata(): PageMetadata {
  const scrollHeight = Math.max(
    document.body.scrollHeight, document.documentElement.scrollHeight,
    document.body.offsetHeight, document.documentElement.offsetHeight,
    document.body.clientHeight, document.documentElement.clientHeight
  );
  
  const scrollPercent = scrollHeight > window.innerHeight 
    ? Math.round((window.scrollY / (scrollHeight - window.innerHeight)) * 100)
    : 0;

  let focusedElementStr = 'None';
  if (document.activeElement && document.activeElement !== document.body) {
    const el = document.activeElement;
    focusedElementStr = `${el.tagName.toLowerCase()}`;
    const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent;
    if (label) focusedElementStr += ` — "${label.substring(0, 30).trim()}"`;
  }

  return {
    url: window.location.href,
    title: document.title,
    scrollPercent,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    focusedElement: focusedElementStr,
  };
}

export function extractSemanticText(root: Element = document.body): string {
  let textLines: string[] = [];

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent?.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        
        const el = node as Element;
        
        if (!isVisible(el, true)) {
          return NodeFilter.FILTER_REJECT;
        }

        const tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'noscript') {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_SKIP;
      }
    }
  );

  let currentNode = walker.nextNode();
  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE && currentNode.textContent) {
      const text = currentNode.textContent.trim().replace(/\s+/g, ' ');
      if (text) {
        const parent = currentNode.parentElement;
        if (parent) {
          const tag = parent.tagName.toLowerCase();
          if (tag === 'h1') textLines.push(`# ${text}`);
          else if (tag === 'h2') textLines.push(`## ${text}`);
          else if (tag === 'h3') textLines.push(`### ${text}`);
          else if (tag === 'li') textLines.push(`- ${text}`);
          else textLines.push(text);
        } else {
          textLines.push(text);
        }
      }
    }
    currentNode = walker.nextNode();
  }

  const fullText = textLines.join('\n');
  const MAX_CHARS = 8000;
  
  if (fullText.length <= MAX_CHARS) {
    return fullText;
  }
  
  // Find the last newline or space before the cutoff to cleanly truncate
  const cutoffIndex = fullText.lastIndexOf('\n', MAX_CHARS) > -1 
    ? fullText.lastIndexOf('\n', MAX_CHARS) 
    : fullText.lastIndexOf(' ', MAX_CHARS);
    
  const cleanTruncation = cutoffIndex > -1 ? fullText.substring(0, cutoffIndex) : fullText.substring(0, MAX_CHARS);
  
  return cleanTruncation + '\n\n... [Page content truncated. If you cannot find the answer, scroll down to reveal more text.]';
}
