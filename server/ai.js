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
export const FORMAT_NAMES = {
  x: X_FORMATS.map((f) => f.format),
  reddit: REDDIT_FORMATS.map((f) => f.format),
};

function buildPrompt(idea, platform, subreddit, count, angle) {
  const formats = platform === 'x' ? X_FORMATS : REDDIT_FORMATS;
  const formatList = formats.map((f) => `- "${f.format}": ${f.description}`).join('\n');

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

  const platformRules =
    platform === 'x'
      ? `
Platform: X (Twitter)
- Hard limit: each post max 280 characters.
- First line must stop the scroll. Short, punchy lines. Line breaks encouraged.
- At most 1 hashtag. No links in the text (user adds links when editing if needed).
- No emoji spam (max 1-2, only if natural).
- Replies are the heaviest signal on X - where natural for the format, invite a response rather than just broadcasting.`
      : `
Platform: Reddit (subreddit: r/${subreddit || 'generic'})
- Title max 300 chars, must be specific and concrete, never vague clickbait.
- Body uses markdown, plain and conversational, humble and genuine.
- ABSOLUTELY no promotional/marketing language, no "sign up", no "check out my blog". Redditors detect and destroy that instantly.
- Write like a real member of r/${subreddit || 'the subreddit'} sharing their experience.`;

  return `You are a viral content strategist who deeply understands what makes content take off on ${platform === 'x' ? 'X (Twitter)' : 'Reddit'}.

A user wants to repurpose this newsletter/blog idea or content into ${count} distinct posts.

SOURCE IDEA/CONTENT:
"""
${idea}
"""
${angleBlock}
${platformRules}

Generate ${count} post variants, each using a DIFFERENT one of these proven viral formats:
${formatList}

Respond ONLY with valid JSON in exactly this shape (no markdown fences, no commentary):
{
  "variants": [
    {
      "format": "<one of the format names above>",
      "title": ${platform === 'reddit' ? '"<reddit post title>"' : 'null'},
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
    title: platform === 'reddit' ? v.title || null : null,
    body: v.body || '',
  }));
}