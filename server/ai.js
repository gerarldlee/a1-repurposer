import OpenAI from 'openai';
import { config, AI_PROVIDERS } from './config.js';

export function activeProvider() {
  const provider = AI_PROVIDERS.includes(config.ai.provider) ? config.ai.provider : 'openai';
  return { key: provider, ...config.ai.providers[provider] };
}

function providerCheck(provider) {
  const missing = [];
  if (!provider.apiKey) missing.push(provider.apiKeyEnv || `${provider.key.toUpperCase()}_API_KEY`);
  if (provider.key === 'ollama' && !provider.baseUrl) missing.push('OLLAMA_BASE_URL');
  if (missing.length) {
    const err = new Error(
      `${provider.name} is not configured (missing: ${missing.join(', ')}). Add them to .env, or pick another AI provider in Settings.`
    );
    err.status = 400;
    throw err;
  }
}

const X_FORMATS = [
  {
    format: 'hook_post',
    description:
      'A single short post (max 280 chars) built around one scroll-stopping first line, one clear idea, and a punchy ending. No hashtags spam (max 1).',
  },
  {
    format: 'thread',
    description:
      'A 3-5 post thread. Post 1 is a hook that promises value. Each post is under 280 chars and ends with a reason to keep reading. Last post has a takeaway + soft CTA.',
  },
  {
    format: 'listicle',
    description:
      'A numbered list: "5 lessons from ..." or "3 things I learned about ...". 3-5 numbered items, each a single punchy skimmable line - easy to quote-tweet one line at a time. Under 280 chars.',
  },
  {
    format: 'contrarian',
    description:
      'A contrarian/against-the-grain take that people want to ARGUE WITH, which drives replies. Pick the opener that fits: "Unpopular opinion: ...", "Nobody talks about ...", or "Everyone thinks X. Wrong. Here is what actually works...". Take a bold, defensible stance - not clickbait-lying. Under 280 chars.',
  },
  {
    format: 'story',
    description:
      'A transformation narrative: "Two years ago I was X. Today I\u2019m Y." (or the equivalent before/after contrast). Or a mini-story with tension and payoff ending with a lesson. The before/after contrast makes it bookmarkable and shareable. Under 280 chars.',
  },
  {
    format: 'open_question',
    description:
      'A post that ENDS with a question people cannot resist answering - real reply bait (replies are the heaviest signal on X). Give a short setup or take, then ask something genuinely open that invites disagreement or experience-sharing. Under 280 chars.',
  },
  {
    format: 'insider_reveal',
    description:
      'An insider-knowledge reveal: "Here is what nobody tells you about ..." Makes readers feel they are getting secret/forbidden knowledge the industry does not want out. Specific, concrete details. Under 280 chars.',
  },
  {
    format: 'screenshot',
    description:
      'A caption written to PAIR WITH AN ATTACHED SCREENSHOT (analytics dashboard, DM, code output, receipt - proof beats claims). The caption contextualizes the image in 1-3 short lines (e.g. "My open rates since I killed the subject line line. Chart below:") and lets the image do the convincing. Under 280 chars. The user attaches the image before posting.',
  },
];

const REDDIT_FORMATS = [
  {
    format: 'value_title',
    description:
      'A text post whose title is a clear, specific, useful promise (e.g. "I tested X for 30 days. Here is what actually worked."). Body delivers the goods in plain, humble, conversational language. NO promotional tone, no marketing-speak. Reads like a genuine community member sharing experience.',
  },
  {
    format: 'discussion',
    description:
      'A discussion-starter post: title poses a specific opinion or question that invites debate, body gives 2-3 sentences of context and asks the community a direct question. Reads like a regular user, not a marketer.',
  },
  {
    format: 'detailed_guide',
    description:
      'A longer text post formatted like a mini-guide: short intro paragraph, then organized sections with concrete details and takeaways. Title states the outcome plainly. Reddit-friendly markdown (headers, lists).',
  },
  {
    format: 'lesson_learned',
    description:
      'A "what I learned the hard way" post: title is specific and honest, body walks through the mistake/situation and the lessons in a humble first-person voice.',
  },
];

// Format names (for angle suggestions elsewhere in the app)
const TIKTOK_FORMATS = [
  {
    format: 'hook_video',
    description:
      'A short-video script whose FIRST 1.5 SECONDS stop the scroll (on-screen hook: a surprising claim, a bold promise, or a "wait, what?" visual). Body = the caption plus a shot-by-shot script (3-6 beats) with the on-screen text for each beat. Hook must work with sound off.',
  },
  {
    format: 'story_time',
    description:
      'A first-person mini-story (something happened to me → tension → payoff → lesson) built as a short video script. Relatable and comment-bait. Body = caption + shot-by-shot beats. Never fictional - ground it in the source idea.',
  },
  {
    format: 'tutorial_demo',
    description:
      'A "watch me do this" how-to: a clear result in the first 2 seconds, then 3-5 fast steps. Body = caption + a step-by-shot script where each step is one visual action. Add on-screen text for each step.',
  },
  {
    format: 'trend_remix',
    description:
      'A script built to ride a trending sound, format or meme template - it fills the template\'s structure but carries the source idea\'s message. Body names the trend/audio to use (as a suggestion the creator picks on-platform) plus the caption and beats.',
  },
  {
    format: 'listicle_video',
    description:
      '"3 things that changed how I ..." - a numbered list delivered fast on screen. Body = caption + one beat per item with bold on-screen text. Items must each be quotable on their own.',
  },
  {
    format: 'duet_stitch',
    description:
      'A script designed to be DUETED or STITCHED: it reacts to or builds on an existing video, or explicitly invites others to stitch it with their take. Body = caption + beats + a line inviting duets/stitches.',
  },
  {
    format: 'myth_bust',
    description:
      'A "everyone thinks X. It\'s actually Y" myth-busting short. Body = caption + beats that state the myth, then the correction with the proof from the source idea. Strong comments and shares.',
  },
];

const YT_SHORTS_FORMATS = [
  {
    format: 'shorts_hook',
    description:
      'A YouTube Shorts script opening with a promise the viewer wants kept (a number, a result, a warning). Body = the title/description plus shot-by-shot beats, written so the payoff lands inside 60 seconds.',
  },
  {
    format: 'answer_short',
    description:
      'A "why / how / what is X" short that fully answers one specific question in under 60 seconds. Body = title + description + beats. Write it so it also works as a searchable answer, not just a scroll-past.',
  },
  {
    format: 'tutorial_short',
    description:
      'A step-by-step how-to Short: result first, then 3-5 numbered steps, one visual per step with on-screen text. Body = title + description + beats.',
  },
  {
    format: 'listicle_short',
    description:
      'A "top 3 / 5 ..." Short with one punchy, self-contained item per beat. Body = title + description + beats. Each item should be the kind of thing a viewer screenshots.',
  },
  {
    format: 'story_short',
    description:
      'A compact first-person narrative Short (setup → tension → resolution → lesson) that ends on a line worth rewatching. Body = title + description + beats.',
  },
  {
    format: 'comparison_short',
    description:
      'A side-by-side "before vs after" or "A vs B" Short that makes the difference obvious visually. Body = title + description + beats, one per side of the comparison.',
  },
];

const INSTAGRAM_FORMATS = [
  {
    format: 'reel_script',
    description:
      'An Instagram Reel script: a scroll-stopping first second, a tight story arc, and a loopable ending. Body = the caption (with a natural CTA) plus shot-by-shot beats with on-screen text.',
  },
  {
    format: 'carousel_caption',
    description:
      'A carousel/post set: title = the cover line for slide 1, body = the caption plus slide-by-slide copy (one idea per slide, skimmable). The caption should make someone swipe to the last slide.',
  },
  {
    format: 'photo_caption',
    description:
      'A caption written to pair with an ATTACHED PHOTO (the user supplies the image - proof, a screenshot, a behind-the-scenes shot). Title = a short punchy hook line, body = the caption that frames the photo in a few lines and lets the image carry the weight.',
  },
  {
    format: 'story_sequence',
    description:
      'A Stories sequence: 4-7 individual frames with the copy for each frame (one line per frame, swipe-up/poll/question CTA on the last). Body = caption + frame-by-frame copy.',
  },
  {
    format: 'saveable_list',
    description:
      'A "save this for later" post: title = a clear, useful promise ("5 settings I change on every client project"), body = the numbered list in the caption, written so it is genuinely worth bookmarking. Saves are the ranking signal on Instagram.',
  },
  {
    format: 'behind_the_scenes',
    description:
      'A behind-the-scenes / founder-story post that humanizes the account (the mistake, the process, the real numbers). Title = hook line, body = caption. Honest, first-person, no sales tone.',
  },
];

// Every supported platform: label for prompts/UI, its formats, the rules that
// shape the output, and whether the platform needs a separate title/hook field.
const PLATFORMS = {
  x: {
    label: 'X (Twitter)',
    formats: X_FORMATS,
    needsTitle: false,
    rules: (subreddit) => `
Platform: X (Twitter)
- Hard limit: each post max 280 characters.
- First line must stop the scroll. Short, punchy lines. Line breaks encouraged.
- At most 1 hashtag. No links in the text (user adds links when editing if needed).
- No emoji spam (max 1-2, only if natural).
- Replies are the heaviest signal on X - where natural for the format, invite a response rather than just broadcasting.`,
  },
  reddit: {
    label: 'Reddit',
    formats: REDDIT_FORMATS,
    needsTitle: true,
    rules: (subreddit) => `
Platform: Reddit (subreddit: r/${subreddit || 'generic'})
- Title max 300 chars, must be specific and concrete, never vague clickbait.
- Body uses markdown, plain and conversational, humble and genuine.
- ABSOLUTELY no promotional/marketing language, no "sign up", no "check out my blog". Redditors detect and destroy that instantly.
- Write like a real member of r/${subreddit || 'the subreddit'} sharing their experience.`,
  },
  tiktok: {
    label: 'TikTok',
    formats: TIKTOK_FORMATS,
    needsTitle: true,
    rules: () => `
Platform: TikTok (vertical short video, the user attaches the video file themselves)
- "title" is the ON-SCREEN HOOK: the text that appears in the first 1-2 seconds. Max ~8 words, no hashtag, must be readable at a glance.
- "body" has two clearly labelled parts: "Caption:" (max ~150 characters, the text typed into the caption box) and "Script:" (shot-by-shot beats, each with its on-screen text).
- The hook must work with the sound OFF. The first 1.5 seconds decide everything.
- 3-6 beats, total video 15-45 seconds.
- At most 3 hashtags, at the end of the caption. No emoji spam.
- Every shot must be vertical (9:16) and visual. Never write a beat that is just talking to camera with no visual interest.`,
  },
  yt_shorts: {
    label: 'YouTube Shorts',
    formats: YT_SHORTS_FORMATS,
    needsTitle: true,
    rules: () => `
Platform: YouTube Shorts (vertical short video, the user attaches the video file themselves)
- "title" is the video TITLE: max 100 characters, front-load the keyword or the curiosity gap, no clickbait the video does not pay off.
- "body" has two clearly labelled parts: "Description:" (1-2 short sentences plus 3-4 relevant hashtags) and "Script:" (shot-by-shot beats with on-screen text).
- Vertical 9:16, total runtime 30-60 seconds, retention matters more than length.
- Open on the payoff or a strong promise, never on an intro or logo.
- No links in the description (YouTube suppresses them) and no emoji spam.`,
  },
  instagram: {
    label: 'Instagram',
    formats: INSTAGRAM_FORMATS,
    needsTitle: true,
    rules: () => `
Platform: Instagram (Reel, carousel, photo or Stories; the user attaches the media file themselves)
- "title" is the hook line: the on-screen text for a Reel/photo, or the cover line for a carousel. Max ~12 words.
- "body" has two clearly labelled parts: "Caption:" (the caption text) and then the format-specific content (script beats, slide copy, or story frames), each line prefixed with the beat/slide/frame number.
- Write for saves and shares first, likes second. One clear idea per slide or beat.
- Hashtags: 3-5 max, grouped at the end of the caption. No spam blocks of 20.
- No emoji spam, no "link in bio" unless the format genuinely ends on a CTA.`,
  },
};

export const PLATFORM_KEYS = Object.keys(PLATFORMS);

export function isPlatform(key) {
  return Object.hasOwn(PLATFORMS, key);
}

export function platformLabel(key) {
  return PLATFORMS[key]?.label || key;
}

export function platformNeedsTitle(key) {
  return Boolean(PLATFORMS[key]?.needsTitle);
}

// Video-first platforms: they cannot be posted without an attached video file.
export const VIDEO_PLATFORMS = ['tiktok', 'yt_shorts'];

// Format names (for angle suggestions elsewhere in the app)
export const FORMAT_NAMES = Object.fromEntries(
  PLATFORM_KEYS.map((key) => [key, PLATFORMS[key].formats.map((f) => f.format)])
);

function buildPrompt(idea, platform, subreddit, count, angle) {
  const spec = PLATFORMS[platform];
  const formatList = spec.formats.map((f) => `- "${f.format}": ${f.description}`).join('\n');

  const angleBlock = angle
    ? `
CONTENT ANGLE — every variant must be written from this specific angle (not the generic idea):
- Title: ${angle.title}
- Hook: ${angle.hook || '—'}
- Why it works: ${angle.rationale || '—'}
${angle.facts?.length ? `- Supporting facts (ground every claim in these; do not invent statistics beyond them):\n${angle.facts.map((f) => `  * ${f}`).join('\n')}` : ''}
${angle.formats?.length ? `- Suggested formats for this angle: ${angle.formats.join(', ')} (prefer these, but any listed format is allowed if it fits better).` : ''}
`
    : '';

  const titleShape = spec.needsTitle
    ? '"title": "<the title / hook line this platform needs>",'
    : '"title": null,';

  return `You are a viral content strategist who deeply understands what makes content take off on ${spec.label}.

A user wants to repurpose this newsletter/blog idea or content into ${count} distinct posts.

SOURCE IDEA/CONTENT:
"""
${idea}
"""
${angleBlock}
${spec.rules(subreddit)}

Generate ${count} post variants, each using a DIFFERENT one of these proven viral formats:
${formatList}

Respond ONLY with valid JSON in exactly this shape (no markdown fences, no commentary):
{
  "variants": [
    {
      "format": "<one of the format names above>",
      ${titleShape}
      "body": "<the post text>"
    }
  ]
}

For "thread" format on X, join the individual posts with the separator "\\n\\n---\\n\\n" inside body. All other formats: body is a single post.

Rules:
- Each variant must take a genuinely different angle on the source idea.
${angle ? '- All variants stay on the given CONTENT ANGLE but attack it from different directions (different formats, different entry points, different emotions).' : ''}
- Optimize for saves, shares, replies, and upvotes - not just impressions.
- Never invent fake statistics, quotes, or claims not implied by the source.`;
}

// Shared chat-with-JSON-response helper: picks up the active provider, tries
// response_format first (OpenAI/OpenRouter), retries without it (Ollama etc.),
// and repairs loosely-formatted JSON output.
export async function chatJSON({ system, prompt, temperature = 0.9 }) {
  const provider = activeProvider();
  providerCheck(provider);

  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl });
  const baseRequest = {
    model: provider.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature,
  };

  let completion;
  try {
    completion = await client.chat.completions.create({
      ...baseRequest,
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    const status = err?.status;
    const msg = err?.message || '';
    if (status === 400 && /response_format|json_object|format/i.test(msg)) {
      completion = await client.chat.completions.create(baseRequest);
    } else {
      throw new Error(`${provider.name} request failed: ${msg}`);
    }
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('AI returned an empty response');

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse AI response as JSON');
    return JSON.parse(match[0]);
  }
}

export async function generateVariants({ idea, platform, subreddit, count = 4, angle }) {
  const prompt = buildPrompt(idea, platform, subreddit, count, angle);

  const parsed = await chatJSON({
    system: 'You write viral social content and always respond with strictly valid JSON. No markdown fences.',
    prompt,
  });

  const variants = Array.isArray(parsed.variants) ? parsed.variants : [];
  if (!variants.length) throw new Error('AI returned no variants');

  return variants.map((v) => ({
    platform,
    format: v.format || null,
    subreddit: platform === 'reddit' ? subreddit || null : null,
    title: platformNeedsTitle(platform) ? v.title || null : null,
    body: v.body || '',
  }));
}