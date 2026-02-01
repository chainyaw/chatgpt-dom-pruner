# chatgpt-dom-pruner

Prune old conversation DOM nodes in ChatGPT Web UI to reduce input lag and improve rendering performance.

---

## Motivation

Long ChatGPT conversations can become noticeably slow over time:
- Typing latency increases
- Scrolling becomes sluggish
- UI responsiveness degrades, especially when Canvas is enabled

In practice, this is **not a memory issue**, but a **DOM size problem**.
When thousands of DOM nodes accumulate in the conversation area, browser layout, rendering, and React reconciliation become increasingly expensive.

**chatgpt-dom-pruner** addresses this by pruning older conversation DOM nodes while keeping recent messages fully interactive.

---

## What This Extension Does

- Keeps the **latest messages** in the DOM
- **Collapses older messages** into an in-memory store
- Allows you to **expand older messages incrementally** when needed
- Significantly **reduces DOM node count**
- Improves:
  - Typing responsiveness
  - Scrolling smoothness
  - Overall UI performance in long chats

All operations are performed **locally in the browser**.

---

## What This Extension Does NOT Do

- ❌ Does NOT send data to any server
- ❌ Does NOT collect or track user data
- ❌ Does NOT modify or intercept network requests
- ❌ Does NOT alter ChatGPT responses or prompts

This is a **pure client-side DOM optimization tool**.

---

## How It Works (High Level)

1. Monitors the ChatGPT conversation area (`<main>`)
2. Retains a configurable number of **latest conversation turns**
3. Removes older DOM nodes and stores them as `outerHTML` in memory
4. Provides a bottom control bar to:
   - Expand older messages in chunks
   - Collapse expanded content back to a minimal DOM state

This design keeps the DOM small while preserving access to conversation history.

---

## Performance Measurement

You can verify the effect using these browser console commands:

### Total DOM nodes (entire page)
```js
document.getElementsByTagName("*").length
