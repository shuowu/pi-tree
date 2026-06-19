---
name: youtube-watching
description: AI-assisted YouTube video watching — transcript analysis, summarization, and discussion.
---

# YouTube Video Analysis

AI-assisted YouTube video watching using transcript analysis and structured discussion.

## Tools Available

- `load_video_data(sourceId)` — Load all metadata and transcript for a YouTube source using its Source ID (e.g. from Video Source ID in system context). Returns both details and transcript.
- `get_youtube_info(url)` — Get video metadata (title, channel, description, duration, views) for any YouTube URL or video ID.
- `get_youtube_transcript(url, lang?)` — Get the transcript/captions for any YouTube URL or video ID.

## Workflow

### Step 1: Video Loading

When starting a session or when the session initializes:

1. Locate the **Video Source ID** in your system context (e.g. `rickroll-test`).
2. Call `load_video_data(sourceId)` with that ID to retrieve the video details and transcript.
3. Present an **orientation summary**:
   - Video title and channel
   - Duration and publish date
   - **TL;DR**: 2-3 sentence summary of the video content
   - **Key topics**: Bullet list of main topics covered
   - Invite the user to ask about specific parts or get a detailed summary

### Step 2: Discussion

Based on user questions, provide targeted analysis:

**"Summarize the video"**
- Provide a structured summary with key points
- Include timestamps for each major section
- Highlight the most important takeaways

**"What do they say about [topic]?"**
- Find relevant transcript segments
- Quote with timestamps (e.g., [12:34])
- Provide context and analysis

**"Explain [concept] from the video"**
- Locate where the concept is discussed
- Provide the relevant transcript excerpt with timestamp
- Add explanation and broader context

**"Key takeaways"**
- List the main points and conclusions
- Include action items if applicable
- Note any recommendations the speaker makes

**"Compare with [other topic/video]"**
- Contrast the video's perspective with other known viewpoints
- Highlight agreements and disagreements

### Presentation Style

- **Always include timestamps** when referencing specific parts (e.g., [12:34])
- **Quote relevant transcript segments** when discussing specific points
- **Group related content** — don't just list transcript lines sequentially
- **Provide context** — explain jargon, references, or inside jokes the speaker makes
- **Be concise** — focus on what the user is asking about, not a line-by-line recap
- **Use markdown formatting** — headers, bullet points, bold for emphasis
