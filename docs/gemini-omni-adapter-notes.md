# Gemini Omni (Veo replacement) — adapter notes

Status: **implemented, not run against the live API.** `skyloom-core/src/providers/geminiOmni.ts`.

Verified from the REST example the owner pasted from the official page:
`POST https://generativelanguage.googleapis.com/v1beta/interactions`, JSON body `{ "model": "gemini-omni-1.1-flash", "input": "<prompt>" }`.
Everything else below is unverified (the session could not reach ai.google.dev).

Implementation choices that follow from that:
- Key goes in the `x-goog-api-key` header, not the `?key=` query the example shows, so it cannot end up in logs or error text. (If the header is rejected, that is the first thing to check.)
- The response layout is unknown, so `findVideo` searches the whole JSON for an item with a `video/*` mime type and either base64 `data` or a `uri`/`url`.
- Duration, aspect ratio and resolution are NOT sent: the example has none and the field names are unverified. Put them in the provider's "extra parameters" JSON if the docs show them (same for every clip in a batch).
- `fixedSeconds` makes the estimate and budget use a fixed clip length, for models that ignore the requested duration.
- Inline video is saved by the desktop shell to `videos/NNN.<ext>`; a `uri` result goes through the normal https downloader (which sends no API key, so a URI that needs one will fail with a per-item error).

## Why this, not Veo
Google's Gemini API deprecations page (read via search summary only) lists `veo-3.1-lite-generate-preview`, `veo-3.1-generate-preview` and
`veo-3.1-fast-generate-preview` shutting down **22 Oct 2026**, replaced by `gemini-omni-1.1-flash`. One source says the date is a floor, not a
fixed day. Veo on Vertex AI (`veo-3.1-generate-001`) is reported as unaffected (unverified).

## What third-party sources say (all unverified, some conflicting)
- Not a long-running operation like Veo (`:predictLongRunning`). It is `POST /v1beta/interactions` with `model` and `input`.
- Output options go in a `response_format` object (aspect ratio, resolution, duration). Duration reported as 3–10 s (one source says 10 s fixed).
- Video returns inside `steps[]` as a content item with `mime_type: video/mp4` and **base64 `data`**; a URI delivery mode is mentioned but its field name is not documented anywhere found.
- Price about $0.10 per second of 720p video ($17.50 per 1M video output tokens); a 360p draft price of ~$0.03/s appears in one source only.
- Model id conflict: `gemini-omni-flash-preview` (older preview) vs `gemini-omni-1.1-flash` (stable).

## Still to verify with a real call
1. Exact auth header and request body (read the REST tab of https://ai.google.dev/gemini-api/docs/omni).
2. Inline-base64 output means `Output.media.bytes`; the app currently only saves `media.url`, so `downloadBatch` needs a bytes path (write file directly, same size cap).
3. Whether a URI mode exists, and whether it needs the API key to fetch.
4. A preset-style duration/aspect table like `falPresets.ts`; price entered by the user, not hard-coded.
