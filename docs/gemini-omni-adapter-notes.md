# Gemini Omni (Veo replacement) — adapter notes

Source: https://ai.google.dev/gemini-api/docs/omni, read on 2026-10-17. Implemented in `skyloom-core/src/providers/geminiOmni.ts`.
**Still not run against the live API with a real key.**

## Confirmed by the official page
- `POST https://generativelanguage.googleapis.com/v1beta/interactions`, body `{ "model": "gemini-omni-1.1-flash", "input": "<prompt>" }`.
  The page's own REST examples also use the `x-goog-api-key` header, which is what we send (not `?key=`).
- `response_format`: `{ "type": "video", "aspect_ratio": "9:16" | "16:9", "resolution": "360p" | "720p" | "1080p" | "4k", "delivery": "uri" }`.
  Only 9:16 and 16:9 are documented (the app refuses 1:1 for Omni). 1080p and 4k are upscaled. Default is landscape 720p.
- **There is no duration parameter.** The model makes its own shots ("a few different shots" by default; "single continuous shot" in the prompt keeps it to one).
  So the batch's "clip length" is only used to price the clip; set the provider's "billed seconds per clip" to what you actually see.
- Response (REST): `steps[]` → item `{ "type": "model_output", "content": [{ "type": "video", "mime_type": "video/mp4", "data": "<base64>" }] }`, `status: "completed"`.
- Inline base64 is limited to about 4 MB; for larger videos use `delivery: "uri"`. The response then carries
  `uri: "https://generativelanguage.googleapis.com/v1beta/files/<id>:download?alt=media"`; poll `GET /v1beta/files/<id>` until `state` is `ACTIVE`
  (`FAILED` = give up), then download. The adapter does this, sending the key on both calls and only to the configured host.
- Google recommends `background:false, store:false, stream:false` for synchronous generation; the adapter sends them. (`store:false` means the clip can't be edited in a later turn; we never do.)
- Not supported: system instructions, temperature, top_p, negative prompts (put negatives in the prompt). All output carries SynthID.

## Not on that page (so not hard-coded)
- Price. Third-party sources say about $0.10 per second of 720p video ($17.50 per 1M video output tokens); the user enters the rate from Google's pricing page.
- Rate limits for this model.

## Veo
The Veo 3.1 preview models are listed on Google's deprecations page for shutdown on 22 Oct 2026 (replacement `gemini-omni-1.1-flash`).
No Veo adapter is planned.
