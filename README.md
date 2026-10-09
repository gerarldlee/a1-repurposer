# Repurposer

Turn newsletters and blog ideas into viral **X posts** and **Reddit submissions**. Generate → approve → schedule → auto-post.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env   # then edit .env
npm start
```

Open **http://localhost:3000**

## Configuration

| What | Where |
|---|---|
| AI provider (pick one) | `.env` → `AI_PROVIDER=openai\|openrouter\|opencodego\|ollama`, or switch anytime in the Settings tab |
| OpenAI key | `.env` → `OPENAI_API_KEY` |
| OpenRouter key | `.env` → `OPENROUTER_API_KEY` (one key, many models) |
| OpenCode Go key | `.env` → `OPENCODE_API_KEY` (from opencode.ai/auth; cheap subscription) |
| Ollama | `.env` → `OLLAMA_BASE_URL` + `OLLAMA_MODEL` (local, free, no key) |
| Reddit account | Settings tab in the UI, or `.env` |
| X account | `.env` → `X_BEARER_TOKEN` (official API, 500 posts/mo free) **or** "Connect X Account" button in Settings (browser session, no API needed) |
| Research (Knowledge tab) | `.env` → `TAVILY_API_KEY` (from tavily.com, free tier: 1000 searches/mo) |

The active provider is shown on the server startup line and in the Settings tab; you can switch providers without restarting. Switching in the Settings tab writes `AI_PROVIDER=...` back to `.env`, so `.env` is always the single source of truth — editing it by hand works too (restart to pick up manual edits). Providers that aren't configured stay visible but unusable, so you can flip between them freely.

### Reddit one-time setup (2 minutes)
1. Go to https://www.reddit.com/prefs/apps → "create another app"
2. Choose **script** type, name it anything, redirect URI: `http://localhost:3000`
3. Copy the client ID (under the app name) and secret into the Settings tab with your Reddit username/password.

> Note: accounts with 2FA enabled need an "app password" style TOTP in the password field, or 2FA disabled — Reddit's password grant doesn't accept the second factor.

## How it works

1. **Create** — paste your idea/content, pick platform (X or Reddit + subreddit), hit Generate. AI produces 3–8 variants in proven viral formats.
2. **Knowledge** — the same idea/content/blog/product runs through a research pipeline: it's parsed into a brief, the web is swept (Tavily) for competitors, complaints, trends and similar startups, then synthesized into a knowledge report with sub-tabs (Features, Competitors, Pain Points, Market Gap, Customers, Trends, Similar Bets, Penetration, Pricing, Positioning, Wedge, Risks, Sources). Runs in the background with live progress; every claim cites its sources.
3. **Angles** — from a knowledge report, generate 10–20 distinct content angles, each grounded in a specific fact (a pain point, a competitor weakness, a trend, a pricing gap, a similar startup's lesson) with a hook and suggested viral formats. Each angle has a "Generate posts from this angle" button that feeds the Create tab's generator with the angle + its supporting evidence.
4. **Approve** — edit, regenerate individual variants, attach a screenshot (X), approve the ones you like.
5. **Schedule** — pick a date/time (or post immediately).
6. **Auto-post** — a scheduler checks every minute and publishes due posts. Reddit goes through the official API; X tries the official API first (if configured) and falls back to a saved browser session.

### X viral formats (8)

| Format | Angle |
|---|---|
| `hook_post` | Scroll-stopping single post, one clear idea |
| `thread` | 3–5 posts, hook → value → takeaway + CTA |
| `listicle` | "5 lessons from..." — skimmable, quotable lines |
| `contrarian` | "Unpopular opinion:" / "Nobody talks about..." / "Everyone thinks X. Wrong." — stance people argue with (replies are the heaviest signal) |
| `story` | "Two years ago I was X. Today I'm Y." transformation arc |
| `open_question` | Ends with a question people can't resist answering — reply bait |
| `insider_reveal` | "Here's what nobody tells you about..." secret-knowledge framing |
| `screenshot` | Caption that pairs with an attached image — proof beats claims |

### Screenshot posts (X)

The `screenshot` format (and any X variant) accepts an attached image (≤5MB, png/jpg/gif/webp). Images are stored in `uploads/` and posted automatically.

> X's media upload API requires a *user-context* OAuth token — an app-only `X_BEARER_TOKEN` **cannot attach images**. Posts with images therefore always go through the browser-session path (Connect X Account in Settings). Text-only posts still use the API when configured.

## Notes

- Everything is local: SQLite (`data.db`), sessions (`.x-session/`), screenshots (`uploads/`), credentials. Don't commit them.
- Browser-session posting to X is a fallback convenience for text — and the *only* path for image posts (see above). The official API tier is recommended for text-only volume (free tier covers 500 single posts/month).
- Failed posts show the error in the Queue tab and can be retried with one click.