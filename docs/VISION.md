# Vision

## From Terminal to GUI — Without Losing the Magic

Pi-reader started as a personal experiment. I was reading books with [Pi](https://pi.dev) in the terminal — a minimalist AI agent built around tree-structured conversations. No tabs, no dashboards, no "reading mode." Just me, a book, and an AI that could go as deep as I wanted on any topic.

It was genuinely the best way I'd ever read a non-fiction book. The tree structure meant I could branch off into a tangent — *"wait, how does this connect to what I read last week?"* — without losing my place. Every branch preserved context. Every conversation was a map of how I actually thought about the material, not a linear highlight dump.

But it was also a terminal tool. And that meant I was the only person in my family who could use it.

My wife reads more books than I do. My parents are curious about ideas but would never open a terminal. The gap between "this is incredible" and "nobody else can use it" felt like a problem worth solving.

## The GUI Trap

Most AI apps solve this by building a polished GUI — but in doing so, they impose the builder's mental model on the user. You get preset workflows, fixed layouts, and interaction patterns that work for the demo but break for real use. The builder decides what's important; the user adapts.

Pi-reader tries to avoid this trap. The UI is real — anyone can pick it up — but the underlying model is the same minimalist tree structure from the terminal. You don't navigate through the builder's idea of how to read a book. You explore your own way, and the tree captures the shape of your thinking.

## Specialization Over Generalization

There's a bigger idea here about where AI tools are heading.

Right now, the dominant pattern is general-purpose: one model, one interface, infinite use cases. ChatGPT, Claude, Gemini — they can all summarize a book, answer questions about it, generate quizzes. But they do it in a flat, sessionless way. Your conversation disappears. Context resets. There's no *structure* to the interaction.

I think the future looks different. Not one model that does everything, but **specific models doing specific things exceptionally well**, wrapped in purpose-built UX. A reading tool that understands how people actually read. A writing tool that understands how people actually draft. A research tool that understands how people actually explore.

Pi-reader is a bet on that direction. It's not a general chatbot with books bolted on. It's a **reading companion** — and every design decision, from the tree structure to the branching conversations to the zoom in/out controls — serves that single purpose.

## What This Means in Practice

- **The conversation IS the reading experience.** There's no separate "chat" and "reader" — they're the same thing. The AI surfaces book content as quotes and context within the conversation.
- **Structure emerges from reading, not from the app.** The topic tree isn't a preset outline you fill in. It grows as you read, branches when you go deep, and maps your actual journey through the material.
- **Every user gets their own path.** Multi-user support isn't just "separate accounts." Each person builds their own conversation tree, glossary, and reading history for the same book. Two people can read the same book and have completely different trees.
- **The AI works for you, not the other way around.** No "choose your reading mode." No "select a quiz type." You just talk to the AI about the book, and the system figures out whether to continue, branch, summarize, or look something up.
