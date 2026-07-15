const orb = document.getElementById('siri-orb');

if (orb) {
  // Cache window dimensions to prevent layout thrashing in the hot path
  let winWidth = window.innerWidth;
  let winHeight = window.innerHeight;
  let maxDist = Math.sqrt(Math.pow(winWidth / 2, 2) + Math.pow(winHeight / 2, 2));

  // Update cache only when necessary
  window.addEventListener('resize', () => {
    winWidth = window.innerWidth;
    winHeight = window.innerHeight;
    maxDist = Math.sqrt(Math.pow(winWidth / 2, 2) + Math.pow(winHeight / 2, 2));
  }, { passive: true });

  let ticking = false;
  
  document.addEventListener('mousemove', (e) => {
    if (!ticking) {
      // requestAnimationFrame ensures silky smooth 60fps updates without stacking events
      requestAnimationFrame(() => {
        const { clientX, clientY } = e;
        
        // Calculate normalized mouse position from -1 to 1
        const normalizedX = (clientX / winWidth) * 2 - 1;
        const normalizedY = (clientY / winHeight) * 2 - 1;
        
        // Set the max translation in pixels for the entire wrapper
        const maxShift = 10;
        const shiftX = normalizedX * maxShift;
        const shiftY = normalizedY * maxShift;
        
        // Pass raw mouse coordinates as CSS variables
        orb.style.setProperty('--mouse-x', `${shiftX}px`);
        orb.style.setProperty('--mouse-y', `${shiftY}px`);
        
        // Calculate proximity (how close the mouse is to the center of the screen/orb)
        const distanceToCenter = Math.sqrt(
          Math.pow(clientX - winWidth / 2, 2) + Math.pow(clientY - winHeight / 2, 2)
        );
        
        // proximity is 1 when dead center, 0 at the farthest corner
        const proximity = Math.max(0, 1 - (distanceToCenter / maxDist));
        
        // Pass proximity to CSS to drive glow intensity and heartbeat scale
        orb.style.setProperty('--proximity', proximity.toFixed(3));
        
        ticking = false;
      });
      ticking = true;
    }
  });
}

// ==========================================================================
// Zero-Dependency SVG State Machine Connections
// ==========================================================================

function drawStateConnections() {
  const canvas = document.getElementById('sm-canvas');
  if (!canvas) return;
  
  // Clear previous lines
  canvas.innerHTML = '';
  
  const container = document.getElementById('sm-container');
  const containerRect = container.getBoundingClientRect();
  
  // CRITICAL: Set SVG intrinsic dimensions so coordinates map 1:1 without CSS stretching distortion
  canvas.setAttribute('width', containerRect.width);
  canvas.setAttribute('height', containerRect.height);
  canvas.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);
  
  // Define the exact valid transitions mapped from state-machine.ts
  // Now includes external system architecture connections and types
  const connections = [
    // External System Connections
    ['ext-mic', 'sm-LISTENING'],
    ['ext-stt', 'sm-TRANSCRIBING'],
    ['ext-llm', 'sm-CLASSIFYING'],
    ['ext-dom', 'sm-PLANNING'],
    ['ext-worker', 'sm-EXECUTING'],
    ['sm-RESPONDING', 'ext-tts'],
    
    // Core state transitions
    ['sm-IDLE', 'sm-LISTENING'],
    ['sm-IDLE', 'sm-CLASSIFYING'], // Missing: Text input bypasses listening/stt
    ['sm-LISTENING', 'sm-TRANSCRIBING'],
    ['sm-TRANSCRIBING', 'sm-CLASSIFYING'],
    
    // Action Branch
    ['sm-CLASSIFYING', 'sm-PLANNING'],
    ['sm-PLANNING', 'sm-WAITING_FOR_WORKER'],
    ['sm-WAITING_FOR_WORKER', 'sm-PLANNING'],
    ['sm-WAITING_FOR_WORKER', 'sm-COMPLETE'], // Missing: Direct worker resolution
    ['sm-PLANNING', 'sm-EXECUTING'],
    ['sm-PLANNING', 'sm-COMPLETE'], // Missing: Empty plan resolves immediately
    ['sm-EXECUTING', 'sm-PLANNING'], // Missing: Multi-step execution loop
    ['sm-EXECUTING', 'sm-REPLANNING'],
    ['sm-REPLANNING', 'sm-PLANNING'],
    ['sm-EXECUTING', 'sm-COMPLETE'],
    
    // Voice Branch
    ['sm-CLASSIFYING', 'sm-RESPONDING'],
    ['sm-CLASSIFYING', 'sm-WAITING_FOR_REPLY'], // Missing: Classifying can drop straight to waiting
    ['sm-RESPONDING', 'sm-WAITING_FOR_REPLY'],
    ['sm-WAITING_FOR_REPLY', 'sm-CLASSIFYING'],
    
    // Error Handling (Recovery Paths) - marked as 'error'
    ['sm-CLASSIFYING', 'sm-RECOVERING', 'error'],
    ['sm-RESPONDING', 'sm-RECOVERING', 'error'],
    ['sm-PLANNING', 'sm-RECOVERING', 'error'],
    ['sm-WAITING_FOR_WORKER', 'sm-RECOVERING', 'error'],
    ['sm-EXECUTING', 'sm-RECOVERING', 'error'],
    ['sm-REPLANNING', 'sm-RECOVERING', 'error'],
    
    // Resolution
    ['sm-COMPLETE', 'sm-IDLE'],
    ['sm-RECOVERING', 'sm-IDLE']
  ];
  
  // Create explicit rendering layers so normal paths definitively render on top of error paths
  const errorLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const normalLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  canvas.appendChild(errorLayer);
  canvas.appendChild(normalLayer);
  
  connections.forEach(([fromId, toId, type]) => {
    const fromEl = document.getElementById(fromId);
    const toEl = document.getElementById(toId);
    if (!fromEl || !toEl) return;
    
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    
    // Convert to relative coordinates within the SVG canvas
    const startX = fromRect.left + (fromRect.width / 2) - containerRect.left;
    const startY = fromRect.top + (fromRect.height / 2) - containerRect.top;
    
    const endX = toRect.left + (toRect.width / 2) - containerRect.left;
    const endY = toRect.top + (toRect.height / 2) - containerRect.top;
    
    const dx = endX - startX;
    const dy = endY - startY;
    const midY = startY + dy / 2;
    
    let cp1X = startX;
    let cp1Y = midY;
    let cp2X = endX;
    let cp2Y = midY;
    
    // If there is a reverse connection, offset the control points along the normal 
    // vector to prevent the forward and backward lines from perfectly overlapping
    const isBidirectional = connections.some(c => c[0] === toId && c[1] === fromId);
    if (isBidirectional) {
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const nx = -dy / len;
        const ny = dx / len;
        const OFFSET = 24; // Bow amplitude
        cp1X += nx * OFFSET;
        cp1Y += ny * OFFSET;
        cp2X += nx * OFFSET;
        cp2Y += ny * OFFSET;
      }
    }
    
    // Create a smooth cubic bezier curve
    const pathData = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
    
    if (type === 'error') {
      const errorEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      errorEl.classList.add('sm-connection-error');
      errorEl.setAttribute('d', pathData);
      errorEl.setAttribute('data-from', fromId);
      errorEl.setAttribute('data-to', toId);
      errorLayer.appendChild(errorEl);
    } else {
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.classList.add('sm-connection');
      pathEl.setAttribute('d', pathData);
      pathEl.setAttribute('data-from', fromId);
      pathEl.setAttribute('data-to', toId);
      
      const pulseEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pulseEl.classList.add('sm-connection-pulse');
      pulseEl.setAttribute('d', pathData);
      pulseEl.setAttribute('data-from', fromId);
      pulseEl.setAttribute('data-to', toId);
      
      normalLayer.appendChild(pathEl);
      normalLayer.appendChild(pulseEl);
    }
  });
  
  // Hide fixed bottom actions when footer is visible
  const footer = document.querySelector('.landing-footer');
  const bottomActions = document.querySelector('.fixed-bottom-actions');
  
  if (footer && bottomActions) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          bottomActions.classList.add('hidden-actions');
        } else {
          bottomActions.classList.remove('hidden-actions');
        }
      });
    }, { threshold: 0.1 });
    
    observer.observe(footer);
  }
  
  // Email Copy functionality
  const emailBtn = document.getElementById('copy-email-btn');
  const toast = document.getElementById('toast-message');
  
  if (emailBtn && toast) {
    const triggerCopy = (e) => {
      e.preventDefault();
      navigator.clipboard.writeText('imshreyaskn@gmail.com').then(() => {
        toast.classList.add('show');
        setTimeout(() => {
          toast.classList.remove('show');
        }, 3000);
      });
    };
    
    emailBtn.addEventListener('click', triggerCopy);
    emailBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        triggerCopy(e);
      }
    });
  }
}

// Set up interactive hover effects for the state machine nodes
function setupHoverEffects() {
  const container = document.getElementById('sm-container');
  if (!container) return;
  
  container.addEventListener('mouseover', (e) => {
    const node = e.target.closest('.sm-node, .ext-node');
    if (!node) return;
    
    const nodeId = node.id;
    const paths = document.querySelectorAll('#sm-canvas path');
    paths.forEach(p => {
      const isConnected = p.getAttribute('data-from') === nodeId || p.getAttribute('data-to') === nodeId;
      if (isConnected) {
        p.classList.add('highlighted');
        p.classList.remove('dimmed');
      } else {
        p.classList.add('dimmed');
        p.classList.remove('highlighted');
      }
    });
  });
  
  container.addEventListener('mouseout', (e) => {
    const node = e.target.closest('.sm-node, .ext-node');
    if (!node) return;
    
    const paths = document.querySelectorAll('#sm-canvas path');
    paths.forEach(p => {
      p.classList.remove('dimmed', 'highlighted');
    });
  });
}

// Initial draw and robust redraw on window resize
window.addEventListener('load', () => {
  setTimeout(drawStateConnections, 100);
  setupHoverEffects();
  
  // Recalculate SVGs if the user pans the horizontal scroll container on mobile
  const archScroll = document.querySelector('.technical-arch');
  if (archScroll) {
    let scrollTimeout;
    archScroll.addEventListener('scroll', () => {
      if (!scrollTimeout) {
        requestAnimationFrame(() => {
          drawStateConnections();
          scrollTimeout = null;
        });
        scrollTimeout = true;
      }
    }, { passive: true });
  }
});
window.addEventListener('resize', drawStateConnections);

// ==========================================================================
// Download Modal & Action
// ==========================================================================
const downloadBtn = document.getElementById('download-btn');
const downloadModal = document.getElementById('download-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const retryBtn = document.getElementById('retry-download-btn');

// Using the GitHub release URL directly
const ZIP_URL = "https://github.com/imshreyaskn/lucy/releases/download/v1.0.0/lucy-v1.0.0.zip";

function triggerDownload() {
  const a = document.createElement('a');
  a.href = ZIP_URL;
  a.download = 'lucy-v1.0.0.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

if (downloadBtn) {
  downloadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    downloadModal.classList.add('active');
    triggerDownload();
  });
}

if (closeModalBtn) {
  closeModalBtn.addEventListener('click', () => {
    downloadModal.classList.remove('active');
  });
}

if (retryBtn) {
  retryBtn.addEventListener('click', () => {
    triggerDownload();
  });
}

// Close on outside click
if (downloadModal) {
  downloadModal.addEventListener('click', (e) => {
    if (e.target === downloadModal) {
      downloadModal.classList.remove('active');
    }
  });
}
