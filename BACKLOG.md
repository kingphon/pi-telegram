# Project Backlog

## Open Work

- Implement Telegram Extension Sections Platform for the 0.10.0 line.
  - Exit: Runtime registry, main-menu integration, `section:` callback routing, safe section context ports, diagnostics, docs, and at least one small demo/fixture prove ordinary pi extensions can add Telegram menu sections without owning a second poller.
- Explore always-available outbound Telegram tools for queued artifacts and controls.
  - Priority: Low.
  - Idea: Provide tools such as `telegram_attach_file` and `telegram_attach_button` that can be called outside an active Telegram turn, using the paired chat/session as the delivery target when safe.
  - Exit: Design note defines active-turn versus ambient delivery semantics, safety constraints, failure modes, and whether the current `telegram_attach` contract should stay turn-scoped or gain an ambient companion.
- Tighten dependency posture for reproducible extension development.
  - Priority: Medium.
  - Idea: Replace broad peer dependency `*` ranges and dev dependency `latest` ranges with explicit compatible ranges once the supported pi/Node/TypeScript matrix is clear.
  - Exit: `package.json` documents the supported Node expectation and compatible pi package ranges without over-constraining early-stage extension iteration.

## 0.9.7: Bot API 10.0 Alignment

- Update `sendMessageDraft` wrapper for Bot API 10.0 semantics.
  - Priority: High.
  - Idea: API 10.0 allows empty `text` to show a "Thinking…" placeholder; remove the current `text.length === 0 → false` guard in `lib/api.ts`. Add optional `parse_mode` and `entities` parameters to the wrapper so callers can pass rich preview formatting. Consider optional `message_thread_id`.
  - Exit: `sendMessageDraft` passes empty text through to the API, accepts `parse_mode`/`entities`, and tests reflect the new behavior.
- Add guest mode awareness to inbound update handling.
  - Priority: Medium.
  - Idea: Bot API 10.0 introduces `guest_query_id`, `guest_message` in `Update`, and `answerGuestQuery`. The bridge currently only processes standard private-message updates; guest mode may allow replies in chats where the bot is not a member.
  - Exit: Update parsing routes recognize guest fields, and `answerGuestQuery` is available on the API runtime when a use case emerges.
- Support new content types from Bot API 10.0.
  - Priority: Low.
  - Idea: `LivePhoto` / `InputMediaLivePhoto` / `sendLivePhoto`, plus `PaidMediaLivePhoto` and `InputPaidMediaLivePhoto`, are new media shapes. The bridge may need to forward or handle them in inbound media extraction.
  - Exit: Inbound media helpers classify live photos correctly; outbound sending is documented or supported if handlers need it.
- Add reaction management helpers.
  - Priority: Low.
  - Idea: `deleteAllMessageReactions` and `deleteMessageReaction` are new Bot API 10.0 methods. The bridge already uses reactions for queue control; explicit cleanup methods may be useful.
  - Exit: Runtime exposes both methods and documents when they are safe to call.
- Add `BotAccessSettings` methods.
  - Priority: Low.
  - Idea: `getManagedBotAccessSettings` and `setManagedBotAccessSettings` let business bots manage access. Relevant if the bridge ever runs under a business account.
  - Exit: Methods are available on the API runtime and documented.
