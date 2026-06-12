---
title: Vision & Philosophy
description: Why pi-tree exists — building for the input side of AI, tree-structured conversations, and the case for local-first reading tools.
---

# Vision & Philosophy

## The Other Half of AI

Every AI product ships the same pitch: *do more, faster*. Write emails in seconds. Generate code in minutes. Summarize a 300-page report in one click. The entire industry is racing toward **output** — how quickly you can produce things.

Nobody's building for the other side.

**Input** — how you absorb information, make sense of it, connect it to what you already know — that's the harder, quieter problem. And it's the one that actually matters for most of what we do. Before you can write the essay, you need to understand the book. Before you can form an opinion, you need to digest the reporting. Before you can decide, you need to comprehend what you're choosing between.

> AI has made everyone a prolific producer. It hasn't made anyone a better understander.

Pi-tree is built for the input side. It's not about generating content — it's about **ingesting** it. Reading a book. Following a news beat. Working through a research paper. The AI doesn't produce things on your behalf; it thinks alongside you while you absorb and process information, helping you go deeper, draw connections, and build genuine comprehension.

This is a fundamentally different design target, and it leads to fundamentally different decisions — tree-structured conversations instead of linear chat, persistent context instead of throwaway sessions, depth over speed.

## From Terminal to GUI — Without Losing the Magic

Pi-tree started as a personal experiment. I was reading books with [Pi](https://pi.dev) in the terminal — a minimalist AI agent built around tree-structured conversations. No tabs, no dashboards, no "reading mode." Just me, a book, and an AI that could go as deep as I wanted on any topic.

It was genuinely the best way I'd ever read a non-fiction book. The tree structure meant I could branch off into a tangent — *"wait, how does this connect to what I read last week?"* — without losing my place. Every branch preserved context. Every conversation was a map of how I actually thought about the material, not a linear highlight dump.

But it was also a terminal tool. And that meant I was the only person in my family who could use it.

My wife reads more books than I do. My kids are curious about everything but need something they can just click around in. My parents would never open a terminal. The gap between "this is incredible" and "nobody else can use it" felt like a problem worth solving.

## The GUI Trap

Most AI apps solve this by building a polished GUI — but in doing so, they impose the builder's mental model on the user. You get preset workflows, fixed layouts, and interaction patterns that work for the demo but break for real use. The builder decides what's important; the user adapts.

Pi-tree tries to avoid this trap. The UI is real — anyone can pick it up — but the underlying model is the same minimalist tree structure from the terminal. You don't navigate through the builder's idea of how to read a book. You explore your own way, and the tree captures the shape of your thinking.

## Specialization Over Generalization

There's a bigger idea here about where AI tools are heading.

Right now, the dominant pattern is general-purpose: one model, one interface, infinite use cases. ChatGPT, Claude, Gemini — they can all summarize a book, answer questions about it, generate quizzes. But they do it in a flat, sessionless way. Your conversation disappears. Context resets. There's no *structure* to the interaction. And they're all oriented toward the same goal: give me the answer, give me the summary, give me the takeaway. The act of *understanding* is treated as an obstacle to skip past, not an experience worth having.

I think the future looks different. Not one model that does everything, but **specific tools doing specific things exceptionally well**, wrapped in purpose-built UX that respects the activity. A reading tool that understands how people actually read. A research tool that understands how people actually explore. A learning tool that helps you build genuine comprehension, not just collect AI-generated summaries.

Pi-tree is a bet on that direction. It's not a general chatbot with content bolted on. It's a **reading companion** — and every design decision, from the tree structure to the branching conversations to the zoom controls, serves that single purpose: helping you understand what you're taking in.

## Local-First, by Design

Pi-tree doesn't have a cloud backend. There's no account to create, no data synced to someone else's server, no subscription that gates your reading. Everything runs on your machine: the server, the database, your session history, your books.

This isn't just a privacy feature — it's a design philosophy. When you own the entire stack, the tool can be truly yours. You pick the AI model. You pick the provider. You control the cost. And as local AI gets better, you won't need a cloud API at all.

Today, you can already point pi-tree at [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), or any OpenAI-compatible local server. The reading experience with a good 7B or 14B model running on your own hardware is surprisingly capable — and completely offline. No tokens metered, no API costs, no data leaving your network.

> Reading is intimate. The questions you ask about a book — the tangents you explore, the connections you draw — reveal how you think. That data shouldn't live on someone else's infrastructure.

The trajectory here is clear: local models will keep getting better, consumer hardware will keep getting cheaper, and the gap between cloud and local inference will keep shrinking. Pi-tree is built for that future — a world where a powerful, personalized AI reading companion runs entirely on your laptop, no internet required.

## What This Means in Practice

- **The conversation IS the experience.** There's no separate "chat" and "reader" — they're the same thing. The AI surfaces source content as quotes and context within the conversation.
- **Structure emerges from exploration, not from the app.** The topic tree isn't a preset outline you fill in. It grows as you read, branches when you go deep, and maps your actual journey through the material.
- **Every user gets their own path.** Multi-user support isn't just "separate accounts." Each person builds their own conversation tree, glossary, and history for the same source. Two people can read the same book — or follow the same news feed — and have completely different trees.
- **The AI works for you, not the other way around.** No "choose your mode." No "select a quiz type." You just talk to the AI about what you're reading, and the system figures out whether to continue, branch, summarize, or look something up.
- **Your data stays local.** Sources, sessions, conversations, glossaries — everything lives on your machine. Swap providers, run offline with local models, or migrate your data freely. No lock-in, no leaks.

## The Tree as a Primitive

The most interesting thing about pi-tree isn't the reading app — it's the conversation model underneath.

Tree-structured conversations solve a fundamental problem with AI chat: linear conversations force you to choose between depth and breadth. Go deep on a tangent, and you lose your place. Stay on track, and you can't explore. The tree gives you both — branch off freely, and the trunk is always there to return to.

This isn't specific to reading books. The same model works for research, learning, code review, problem-solving — any domain where human thinking naturally branches. *"Wait, what about X?"* shouldn't destroy your context on Y. It should create a branch you can explore and return from.

### Why Trees Produce Better AI

The tree structure isn't just a UX improvement — it fundamentally changes how context flows to the model, and the results are noticeably better.

**The problem with linear chat.** Every AI conversation manages a context window — the rolling buffer of messages the model can "see." In a linear chat, every message you've ever sent is packed into that window. After 30 turns spanning three different topics, the model is tracking all of them simultaneously. It starts hallucinating details from earlier topics, losing the thread of your current question, or ignoring recent instructions in favor of patterns from 20 messages ago. The longer the conversation, the worse this gets — often well before you hit the technical context limit.

**How trees fix this.** When you branch, pi-tree sends only the path from root to the current node — not every sibling, not every tangent, not every abandoned thread. This is context *pruning by design*, and it has cascading benefits:

- **Focused context windows.** If you're deep in a branch about cognitive biases, the model doesn't see your earlier tangent about Nassim Taleb. It sees only the messages that led to where you are right now. Less noise means more accurate, more relevant responses.

- **Significant token savings.** A 50-message linear chat sends all 50 messages on every turn. A tree with 5 branches of 10 messages each sends only ~10 messages for any given interaction. That's an 80% reduction in input tokens — which translates directly to lower cost and faster response times. With cloud APIs priced per token, trees make deep exploration economically viable in a way linear chats can't.

- **Reduced hallucination.** Context pollution — irrelevant information competing for the model's attention — is one of the primary drivers of hallucination in long conversations. When the model sees a discussion about Chapter 3 mixed with a tangent about a different book mixed with a glossary question, it starts blending them. Isolated branches eliminate this class of error entirely.

- **Better instruction following.** Pi-tree uses skill files — markdown instructions that shape how the AI behaves for each source type. In a short, focused branch, the model follows these instructions reliably. In a long linear chat, system instructions get progressively "forgotten" as the conversation history grows and competes for attention. Trees keep the instruction-to-conversation ratio high.

- **Longer effective conversations.** Most people think the limit on AI conversation length is the context window size. In practice, quality degrades far earlier — after ~20-30 turns, linear chats become noticeably less coherent. Trees sidestep this by keeping each branch short and focused. You can explore a source across hundreds of total messages — split across many branches — while every individual interaction stays in the quality sweet spot.

The net effect is that the same model, with the same parameters, produces measurably better results in a tree-structured conversation than in a linear one. This isn't a theoretical benefit — it's something you notice immediately when comparing a 40-message linear chat about a book to a tree with four focused 10-message branches covering the same material.

### Architecture

Pi-tree's codebase is structured around this insight:

- **`@pi-tree/core`** is a pure library — PiSession, TreeManager, model setup — with no environment assumptions. It doesn't know about books, servers, or browsers. Anyone can import it and build a tree-structured AI conversation for any purpose.
- **`@pi-tree/ui`** is a headless-capable component library — ChatView, Breadcrumb, InlineBranches — with prop-driven design and themeable CSS. You can use the default styled components, override the theme tokens, or import only the hooks and build your own UI entirely.
- **`@pi-tree/extension`** is a publishable skill/tool package — reading skills, book parsers — that plugs into the Pi SDK. New domains bring new skills; the infrastructure stays the same.

The reading app is the first instance of this architecture, not the only one. Someone could take `@pi-tree/core` and build a tree-structured study tool, a research notebook, a therapy journal, or a collaborative analysis workspace. The tree doesn't care what you're thinking about — it just preserves the shape of your thinking.

This modularity isn't premature abstraction. It's a consequence of getting the boundaries right: the AI orchestration layer shouldn't know how it's being rendered, and the UI components shouldn't know what AI is behind them. When you separate those concerns cleanly, reusability falls out naturally.

---

::: info Next steps
Ready to try it? Check the [Getting Started guide](/docs/getting-started) to run pi-tree on your own machine, or explore the [Architecture](/docs/architecture) to understand how the pieces fit together.
:::
