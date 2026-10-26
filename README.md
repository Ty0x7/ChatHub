# ChatHub

A Windows desktop environment that shows only your chats. One fills the window, two share it evenly, and three get separate columns. Connection settings stay in right-click menus.

## Run

Double-click **ChatHub.exe on your Desktop**. The source project is `C:\Users\ty0x7\Desktop\ChatHub`.

- `dist/win-unpacked/ChatHub.exe`: faster launch; keep its adjacent runtime files.
- `dist/ChatHub-1.1.0-Windows-x64.exe`: single-file portable build, also copied onto the Desktop. It extracts its runtime each launch.
- Both are unsigned Windows x64 applications with the runtime included.

From source, using Node.js 22.12 or later:

```powershell
cd C:\Users\ty0x7\Desktop\ChatHub
npm.cmd ci
npm.cmd start
```

Build:

```powershell
npm.cmd run build
```

A Git push publishes source, not an installation or GitHub Release. The Windows workflow builds a downloadable Actions artifact; it does not publish a Release.

## Controls

| Action | Shortcut |
| --- | --- |
| Connections | Right-click, or Ctrl+Shift+C |
| Settings | Ctrl+, |
| Reconnect chats | Ctrl+Shift+R |
| Fictional sample preview | Ctrl+Shift+P |
| Move / resize | Drag the slim platform label; resize window edges |
| Send | Enter in that platform's input |
| Close | Alt+F4 |

## Account connections

**Viewing a public channel is different from signing into its account.** A native `CHAT VIEW` label means the page loaded. Only the official platform's UI indicates its actual sign-in state. ChatHub does not import regular browser cookies.

### Twitch

Default **Official chat** uses Twitch's popout chat in a separate saved session. It displays public chat without developer credentials. Open Connections → Twitch → **Open Twitch login**, complete the platform login yourself, then close that window to reload chat. Native moderation dashboards share that Twitch session. Platform challenges, account restrictions, and permissions remain controlled by Twitch.

Existing 1.0 connections default to Official chat, fixing the empty panel caused by a missing developer client ID.

Optional **API** mode remains available in Connections. Save the method before signing in. It requires a Twitch developer client ID and exact registered redirect `http://localhost:47823/callback`. That mode uses browser OAuth, validated tokens, EventSub WebSockets and official chat/moderation APIs. Tokens expire and require sign-in again. Message deletion, ten-minute timeouts and slow mode require moderator permission. Emote names currently render as text in API mode.

### Kick

The official popout `https://kick.com/popout/CHANNEL/chat` can display public chat without account authorization. Connections → Kick → **Open Kick login** opens the official site in ChatHub's persistent Kick session. Use direct account login and confirm your identity in Kick's own UI. Native chat and moderation controls are preserved.

External Google/social login may open in a separate browser without transferring its session back into ChatHub. Prefer direct Kick login. Challenges and anti-bot controls are not bypassed. This native integration does not use Kick API OAuth or a webhook server.

### YouTube

Save your **channel URL or @handle once**, such as `https://www.youtube.com/@Ty0x7`. A new video URL is no longer required for every stream. Legacy live-video links and channel IDs still work.

Google Desktop OAuth setup and your consent are still required for this personal build; registered ChatHub Google credentials are not bundled. Follow [ACCOUNT-SETUP.md](ACCOUNT-SETUP.md). Enter keys directly in Settings, never in Git, issues, or chat.

The connector verifies `channels.list(mine=true)` against the configured handle from `channels.list(forHandle)`. Selecting the wrong Google/Brand Account gives an actionable identity-mismatch error. Active broadcasts are discovered using `liveBroadcasts.list(broadcastStatus=active)`, matched to your channel, and their chat is selected automatically. If several are active, the newest eligible one is used.

An authorized offline channel shows **WAITING** and checks each minute for its next live chat. **SETUP NEEDED** means Google app configuration is missing. YouTube has no ongoing live chat outside a broadcast with chat enabled.

Messages use TLS gRPC `liveChatMessages.streamList` with continuation cursors, bounded deduplication, token refresh and reconnect backoff. REST polling is only a fallback for UNIMPLEMENTED streaming and follows the server's interval. API use consumes the project's quota. Permission, quota and revoked-token errors remain visible.

The required `youtube.force-ssl` scope has a broader Google consent description than chat alone. The app implements chat reading/sending, message deletion and temporary bans, not video editing/deletion. Basic badges and Super Chat amounts are supported; all native polls, gifts, stickers and replay features are not reproduced.

## Local data and safety

- Settings and encrypted credentials normally live under `%APPDATA%\ChatHub`; portable EXEs still use that Windows account's data directory.
- OAuth tokens and the Google Desktop secret use Windows protection through Electron safeStorage. Public app IDs/channel settings are plain configuration. ChatHub does not collect provider passwords itself.
- Twitch and Kick have independent persistent sessions. Sign-out clears the selected session. Removing a column alone retains authorization.
- API chats retain up to 500 messages and 2,000 deduplication IDs in memory. ChatHub does not write a transcript. Provider sites may use their own caches.
- Native pages have sandboxing, context isolation, no Node access or app preload, ordinary web security, denied device permissions and blocked downloads. Navigation stays on the selected platform's HTTPS domains; external links open in the system browser.
- IPC checks its main-frame sender. OAuth uses state-checked loopback callbacks; Google also uses PKCE. Corrupt files are preserved for recovery. Sign-out attempts revocation and explains when the platform cannot confirm it.
- No cloud sync, telemetry, auto-updater or installation is included.
- `node_modules`, builds, test profiles, local account configuration, environment files and signing keys are ignored by Git.

## Validation boundaries

Before handoff, **16 automated tests passed**, covering channel URL parsing/migration, account matching, offline state, broadcast discovery/pagination, quota handling, persistence, OAuth state/PKCE, deduplication, moderation targets, refresh coordination, gRPC resume and Twitch EventSub migration.

Revised desktop checks passed with isolated local fixtures for chat-only presentation, the three layouts, independent native views, sizing, dialogs, encrypted storage, teardown and restart. A fresh public-page check and Windows visual inspection showed both real ty0x7 Twitch and Kick chat panels without submitting credentials.

**The user is doing hands-on testing.** Real account login challenges, Google consent with the user's app, authenticated live-message delivery, sending, moderation and long-duration behavior remain unverified. Public-page loading and fixtures are not proof of authenticated operation.

Optional developer checks:

```powershell
npm.cmd test
npm.cmd run test:desktop
node tests\public-platform-probe.cjs
node tests\portable-smoke.cjs
```

These scripts use ignored `artifacts/` profiles and outputs, separate from your real account sessions. Live probes visit public pages but submit no credentials or messages.

## Official references

[Twitch authentication](https://dev.twitch.tv/docs/chat/authenticating) · [Google Desktop OAuth](https://developers.google.com/youtube/data/live/guides/auth/installed-apps) · [YouTube channels](https://developers.google.com/youtube/data/reference/rest/v3/channels/list) · [YouTube broadcasts](https://developers.google.com/youtube/data/live/reference/rest/v3/liveBroadcasts/list) · [YouTube streaming protocol](https://developers.google.com/youtube/data/live/streaming-live-chat) · [Kick popout](https://help.kick.com/en/articles/7978574-how-to-create-a-kick-chat-dock-in-obs) · [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/)

Application code is MIT licensed. Google's `src/stream_list.proto` sample is Apache-2.0, with its omitted standard Duration import added. The license is in `LICENSES/Apache-2.0.txt` and is included in the build.
