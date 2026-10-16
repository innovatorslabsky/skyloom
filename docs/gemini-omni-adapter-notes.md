# Gemini Omni (Veo replacement) — adapter notes

Status: **not implemented.** The session that wrote this could not reach ai.google.dev, so the request/response shape is unverified.

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

## What the adapter will need once verified
1. Exact auth header and request body (read the REST tab of https://ai.google.dev/gemini-api/docs/omni).
2. Inline-base64 output means `Output.media.bytes`; the app currently only saves `media.url`, so `downloadBatch` needs a bytes path (write file directly, same size cap).
3. Whether a URI mode exists, and whether it needs the API key to fetch.
4. A preset-style duration/aspect table like `falPresets.ts`; price entered by the user, not hard-coded.
