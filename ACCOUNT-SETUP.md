# Connect your accounts

Use Ctrl+Shift+C in ChatHub and save:

- YouTube: `https://www.youtube.com/@Ty0x7`
- Twitch: `https://www.twitch.tv/ty0x7` — keep **Official chat** mode.
- Kick: `https://kick.com/ty0x7`

## Twitch and Kick

Use **Open Twitch login** or **Open Kick login** in Connections. Complete the login and any challenge yourself, then close the login window to reload chat. Confirm the identity in the platform's own UI. Public chat can appear without login; `CHAT VIEW` does not claim an authorized account. Your normal browser has a different session. Prefer Kick's direct account login because external social login may not return a session to ChatHub.

## YouTube: one-time setup

A channel URL is sufficient in ChatHub. No live-video URL is needed.

1. Create/select your project in [Google Cloud Console](https://console.cloud.google.com/) and enable **YouTube Data API v3** in APIs & Services → Library.
2. Configure **Google Auth Platform** consent/branding. If the external app is in testing, add the Google account owning Ty0x7 under **Audience → Test users**.
3. Under **Clients**, create an OAuth client of type **Desktop app**.
4. Enter its **client ID** and **client secret** in ChatHub Settings (Ctrl+,), then save. Do not put credentials in this repository, chat, or issues.
5. In Connections, save `https://www.youtube.com/@Ty0x7` and choose **Sign in to Google**.
6. Complete browser consent and choose the **Ty0x7 YouTube / Brand Account**, rather than a different channel on the same Google login.
7. An authorized channel with no active chat shows **WAITING**. Start a stream with chat enabled and ChatHub discovers it on its next one-minute check.

Google may display its own unverified/testing-app notices, and testing grants may expire under Google's policies. Public distribution requires the appropriate production verification. If authorization is denied, check API enablement, Desktop client type, test-user membership and the selected channel.

[Official Google Desktop instructions](https://developers.google.com/youtube/data/live/guides/auth/installed-apps).

Account consent, real sending and moderation have not been completed for you; you are handling live acceptance.
