# p1228

Three Discord bots — **星燈 (Seitō)**, **言ノ葉 (Kotonoha)**, and
**紡言 (Tsumugi)** — that run the Yonagi Discord server: server
administration and community features, plus two independent read-aloud
(text-to-speech) bots.

[日本語版 README](README.ja.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/mabu-bots/p1228/actions/workflows/ci.yml/badge.svg)](https://github.com/mabu-bots/p1228/actions/workflows/ci.yml)

> **Status: Rebuilt from scratch — under re-implementation.**
> This repository is a from-scratch re-implementation of p1228 in a
> single TypeScript codebase. The previous implementation (a Go
> gateway plus TypeScript workers) is being replaced phase by phase;
> see [DESIGN.md](DESIGN.md) for the plan, the feature-parity spec,
> and what is still undecided. The version numbering restarts at
> v0.1.0 for the rebuild.

## The bots

| Bot | Role |
|---|---|
| 星燈 (general) | Server features and administration: welcome/goodbye messages, auto-roles, blacklist, log routing, sticky messages, role panels, a points economy (daily fortune, lottery, role shop), temporary voice channels, tickets, the Tsukigakure support rooms, and an `/ai` command backed by a local LLM |
| 言ノ葉 (read_aloud_a) | Read-aloud bot with its own voice session: joins a voice channel and reads text-channel messages aloud via a VOICEVOX-compatible engine |
| 紡言 (read_aloud_b) | A second, independent read-aloud bot (same code, separate process and voice session) |

## Architecture

- **Single TypeScript codebase** (Node.js ≥ 22, discord.js). One entry
  point starts any or all of the three bots; shared modules (database
  layer, presence cycle, voice helpers) are used by all of them. The
  previous split into a Go gateway and TypeScript workers is gone —
  each bot now connects to Discord directly with its own token.
- **SQLite storage** via better-sqlite3. The rebuild reads the
  existing production database as-is (schema migrations 001–004,
  25 application tables); no data conversion is performed.
- **Presence cycle**: all bots show a minute-granularity "Playing"
  presence alternating between uptime and the current JST time,
  phase-aligned to the wall clock and sent 200 ms ahead of each minute
  boundary (measured propagation delay), exactly as the previous
  implementation did.

Feature parity with the previous implementation is the acceptance
bar: 24 top-level slash commands (18 for 星燈 incl. 25 subcommands,
3 each for the read-aloud bots), the presence spec above, and the
existing database contents (points balances, shop purchases, settings,
dictionaries).

## Requirements

- Node.js 22 or later
- Three Discord applications (one bot user per bot)
- For read-aloud: a VOICEVOX ENGINE compatible HTTP API
- For `/ai`: a llama.cpp llama-server (OpenAI-compatible API)

## Setup

```bash
npm ci
cp .env.example .env   # fill in the three bot tokens
npm run build
npm start              # all bots; or: node dist/src/index.js general
```

A bot whose token is not set is reported clearly and skipped; the
process exits normally instead of crash-looping.

## Operations

Scheduled jobs run as systemd timers, independent of the bot
processes (definitions and scripts in [deploy/](deploy/README.md)):
daily SQLite backup (03:50 UTC), daily log archive (03:20 UTC,
90-day retention), and a storage monitor every 10 minutes that only
notifies and never deletes automatically.

## Development

This repository follows the family's unified development workflow:
issue first, branch `<type>/<issue-number>-<slug>`, pull request with
`Closes #<number>`, "Rebase and merge". See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
