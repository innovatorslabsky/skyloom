# AutoFlowX — archive notes

AutoFlowX (`innovatorslabsky/AutoFlowX`, 1 commit + merged PR #1, Aug 2026, ~2,100 lines) was reviewed on 2026-10-17 before the owner deletes the repository.
This note keeps what was worth remembering. Nothing else from it was copied.

## What it was
A Chrome extension (Manifest V3, Vite + CRXJS, React 18, React Flow, Tailwind) that drove the *web UIs* of ChatGPT, Grok and Google Flow:
a content script per site filled the prompt box and clicked "generate", a service worker looped over a prompt list, and results were downloaded
with `chrome.downloads`. A side panel took pasted or `.txt`/`.csv` prompts; a React Flow "Workflow Builder" chained Prompt → Platform → Download → Delay nodes.

## Why it was not carried over
- Selectors such as `[data-testid="send-button"]` and `#prompt-textarea` were guesses, never checked against the live sites, and break whenever those sites change.
- Automating consumer web UIs is fragile and may breach those services' terms. Skyloom deliberately uses official APIs with price estimates and a hard budget cap.
- Race in the orchestrator: the "get status" call returns the newest image already on the page, so a prompt can be marked done with the *previous* prompt's image.
- Model list (Veo 3.1 preview, Nano Banana, GPT Image 2) is out of date or irrelevant to API-based work.

## What was reused
- **Bulk idea import from `.txt` / `.csv`** → rewritten properly as `skyloom-app/src/ideas.ts` (real CSV quoting, `;`/tab separators, header detection, limits with notes, tests).

## Ideas worth keeping for later
- **Workflow Builder.** A node graph (idea → text expansion → video provider → download/delay) could model multi-step jobs, e.g. draft cheap, then re-render the chosen ones with a dearer model. Would need a UI framework or a hand-rolled canvas; not planned.
- **Prompt/result history.** AutoFlowX kept a history of prompts and result URLs in `chrome.storage`. Skyloom still has no batch history (only one `batch.json` per run); a list of past runs read from `Documents/Skyloom/*/batch.json` would cover it without a database.
- **Image generation.** The core already has an `image` call kind; an image provider (e.g. a fal image endpoint) would reuse the same queue, budget and preset machinery.
