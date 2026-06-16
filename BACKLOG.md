# Project Backlog

- [ ] Track evidence-backed Telegram Rich Markdown normalization follow-ups.
  - Done when: newly observed Telegram parser-breaking sequences are captured from live/client evidence or minimized fixtures.
  - Done when: each confirmed sequence has a conservative normalization or safe-degradation rule covered by tests.
  - Done when: unconfirmed speculative rewrites remain out of the delivery path.

- [ ] Track a public Pi session-replacement hook before adding Telegram `/new`.
  - [ ] Wait for a safe public Pi API.
    - Done when: Pi exposes an API that invokes the same session-replacement path as terminal `/new`.
    - Done when: the API covers lifecycle, active-run handling, and TUI rerender semantics.
  - [x] Keep unsafe implementation routes rejected.
    - Done when: raw TTY injection remains rejected.
    - Done when: ANSI terminal clearing remains rejected.
    - Done when: private TUI container mutation remains rejected.
    - Done when: shadow `pi` subprocess control remains rejected.
