# YouTube Plugin

YouTube video source plugin for pi-tree. Enables watching and discussing YouTube videos with AI-powered transcript analysis.

## Features

- **Transcript extraction** — Fetches captions/subtitles directly from YouTube (no API key needed)
- **Video metadata** — Title, channel, duration, view count, publish date
- **Embedded player** — Watch the video alongside the AI conversation
- **URL auto-detection** — Paste a YouTube link in the home chat to start instantly

## Tools

| Tool | Description |
|------|-------------|
| `get_youtube_info` | Get video metadata (title, channel, description, duration) |
| `get_youtube_transcript` | Get timestamped transcript/captions |

## Session Profiles

- `youtube.watching` — Default mode for YouTube sources. Includes transcript analysis skill.

## How It Works

1. User pastes a YouTube URL in the home chat
2. Router detects the URL and calls `create_youtube_source` to fetch metadata and create a source
3. A "watching" session is created and the user is redirected
4. The AI fetches the transcript and provides an orientation summary
5. The embedded video player appears in the right sidebar content panel

## Supported URL Formats

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- Bare video ID: `dQw4w9WgXcQ`

## Limitations

- Requires videos to have captions/subtitles (auto-generated or manual)
- No API key needed — uses public YouTube pages
- Private or age-restricted videos may not work
