---
name: "Lucy Voice Agent Design System"
colors:
  bg: "#000000"
  panel-bg: "#0a0a0a"
  text: "#ffffff"
  text-muted: "#71717a"
  accent: "#fbcfe8"
  danger: "#f43f5e"
  border: "#18181b"
  executing: "#34d399"
  transcribing: "#fcd34d"
  responding: "#60a5fa"
---

# Design System: Lucy Voice Agent Extension

## 1. Visual Theme & Atmosphere
Lucy's Voice Agent uses an ultra-dark, high-contrast theme designed for focus and unobtrusive presence in a browser sidepanel. The aesthetic is highly technical but approachable, utilizing deep blacks (`#000000`) for the root background and extremely subtle off-blacks (`#0a0a0a`) for elevated panels.

The visual language relies heavily on state-driven micro-animations (pulsing, spinning, waving) to communicate the agent's real-time cognitive status without overwhelming the user. The primary accent is a soft, glowing pink (`#fbcfe8`), which provides a human, friendly touch against the stark, terminal-like backdrop.

## 2. Color Palette & Roles

### Primary Foundation
- **Deep Black (`#000000`)**: The root application background. Creates a seamless edge against native browser dark modes.
- **Panel Surface (`#0a0a0a`)**: Used for elevated elements like forms and settings cards.
- **Subtle Border (`#18181b`)**: Barely-there dividers and borders to separate chat bubbles and header sections.

### Accent & Interactive
- **Soft Pink Accent (`#fbcfe8`)**: Primary brand color. Used for active listening states, agent chat bubbles, and primary buttons. Creates a soft "wave" animation when the agent is listening.
- **Text Primary (`#ffffff`)**: High-contrast white for primary readability.

### Typography & Text Hierarchy
- **Text Muted (`#71717a`)**: Used for timestamps, state pills, and secondary labels.
- **Agent Header (`#fbcfe8` equivalent)**: The "Parisienne" cursive font uses the primary accent or white.

### Functional States (The "Orb")
- **Executing / Success (`#34d399`)**: Bright emerald green. Pulses/spins when the agent is actively clicking or typing in the DOM.
- **Thinking / Planning (`#fcd34d`)**: Warm amber. Pulses when Llama-3.1 is classifying or planning.
- **Responding / Network (`#60a5fa`)**: Bright blue. Waves when generating Text-to-Speech or awaiting confirmation.
- **Danger / Error (`#f43f5e`)**: Bright rose. Used for the "recovering" state and destructive actions.

## 3. Typography Rules

### Hierarchy & Weights
- **Brand Heading (`Parisienne`, cursive, 2rem, 400)**: Used exclusively for the top-level "Lucy" logo header to contrast with the technical UI.
- **Primary Interface (`Inter`, sans-serif, 14px)**: The workhorse font for all chat messages and UI text. Clean, highly legible at small sizes.
- **Debug / Code (`Courier New`, monospace, 11px)**: Used for the telemetry log.

### Spacing Principles
- **Chat Density**: Messages are compact. 10px 14px padding on chat bubbles, 4px gap between messages from the same sender, 16px gap between conversational turns.

## 4. Component Stylings

### The "Orb" (Mic Indicator)
- **Shape**: Perfect circle (64x64px).
- **Default State**: Dark gray background with an inner shadow (`inset 0 0 10px rgba(0,0,0,0.5)`).
- **Active States**: Dynamically swaps background colors and CSS animations (`pulse`, `wave`, `spin`, `shake`) based on the agent's cognitive state.

### Chat Bubbles (WhatsApp Style)
- **User Messages**: Aligned right. Dark background with a solid white border (`#ffffff`). Border radius: `16px 16px 0 16px` (sharp bottom right).
- **Agent Messages**: Aligned left. Dark background with a pink accent border (`#fbcfe8`). Border radius: `16px 16px 16px 0` (sharp bottom left).
- **Header**: Tiny uppercase tracking above the bubble indicating "USER" or "AGENT".

### Inputs & Forms (Settings)
- **Fields**: Background `#0a0a0a` with a 1px border (`#18181b`). 6px border radius.
- **Focus State**: The border transitions to the pink accent color (`#fbcfe8`) with no outline.

### Buttons
- **Primary Action**: Solid background (`#fbcfe8`) with inverted black text. High contrast, 4px border radius.
- **Ghost/Icon Actions**: Transparent background, text color `#71717a`, hovering to `#ffffff`.

## 5. Layout Principles

### Grid & Structure
- **Root Layout**: A full-height (`100vh`) flexbox column.
- **Flex Distribution**: The header is fixed (`flex-shrink: 0`), the chat log expands (`flex-grow: 1`) with hidden/minimal scrollbars, and the status orb sits at the bottom (`margin-top: auto`).

### Whitespace Strategy
- **Edge Padding**: A consistent `16px` around the entire `body`.
- **Component Gaps**: Forms use tight `6px` gaps between labels and inputs; major sections use `12px` to `16px` margins.

## 6. Design System Notes for Stitch Generation

### Language to Use
When prompting Stitch, use terms like "ultra-dark sidepanel", "WhatsApp-style chat bubbles with sharp corners", "animated status orb", and "high-contrast pink accents". Focus on the "terminal meets conversational UI" aesthetic.

### Color References
- Background: `#000000`
- Agent Accent: `#fbcfe8`
- User Accent: `#ffffff`
- Borders: `#18181b`

### Component Prompts
- **Chat Log**: "Create a chat interface where user messages align right with a white border and a sharp bottom-right corner, and agent messages align left with a soft pink border and a sharp bottom-left corner."
- **Status Orb**: "Create a 64x64 circular status indicator that glows softly and pulses."

### Incremental Iteration
Start by establishing the black background and the flexbox column layout. Then build the chat bubble primitives. Finally, add the settings forms and the animated status orb at the bottom.
