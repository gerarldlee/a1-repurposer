import { config } from './config.js';
import { chatJSON, FORMAT_NAMES, PLATFORM_KEYS } from './ai.js';

// Web research + knowledge extraction, modeled on the litmus deep-reporting
// pipeline (parse -> web sweep -> grounded synthesis), reimplemented for
// this stack. Runs as a background job; progress is reported via onUpdate.

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const MAX_RESULTS_PER_QUERY = 8;
const MAX_SWEEP_RESULTS = 24;

export const KNOWLEDGE_STAGES = ['parsing', 'researching', 'synthesizing', 'done'];

// ---------------------------------------------------------------- tavily

function normalizeUrl(url) {
  return String(url || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export async function tavilySearch(apiKey, query) {
  const response = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, max_results: MAX_RESULTS_PER_QUERY, search_depth: 'basic' }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const err = new Error(`Tavily search failed (HTTP ${response.status}): ${body.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  return (data.results || [])
    .filter((r) => r.title && r.url)
    .map((r) => ({ title: r.title, url: r.url, snippet: r.content || '', score: r.score ?? 0 }));
}

export function mergeSweepResults(sweeps, cap = MAX_SWEEP_RESULTS) {
  const byUrl = new Map();
  for (const results of sweeps) {
    for (const result of results) {
      const key = normalizeUrl(result.url);
      const existing = byUrl.get(key);
      if (!existing || (result.score ?? 0) > (existing.score ?? 0)) {
        byUrl.set(key, result);
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, cap);
}

function requireTavily() {
  if (!config.tavily.apiKey) {
    const err = new Error(
      'TAVILY_API_KEY is not configured. Knowledge extraction needs web search — add the key to .env (free at tavily.com).'
    );
    err.status = 400;
    throw err;
  }
  return config.tavily.apiKey;
}

// ---------------------------------------------------------------- prompts

const PARSE_SYSTEM = `You are a market research analyst. Turn a raw idea, newsletter, blog post, or product description into a structured research brief that will drive web searches.

Respond ONLY with valid JSON (no markdown fences) in exactly this shape:
{
  "name": "<short name for the idea/product>",
  "oneLiner": "<one sentence on what it is>",
  "category": "<the product/content category, e.g. 'freelancer expense tracking'>",
  "targetCustomer": "<who this is for>",
  "features": ["<3-8 concrete features or topics the content/product covers>"],
  "searchQueries": ["<6-8 diverse web search queries>"]
}

Rules:
- Ground everything in the user's text. Do not add features or claims the user did not describe.
- searchQueries must mix styles: "best <category> software", "<category> app", "<category> alternatives", "<category> for <customer>", plus at least one demand-signal query like "how do people solve <problem>" and one complaint query like "<category> problems complaints".`;

const SYNTHESIS_SYSTEM = `You are a rigorous, skeptical market analyst. You extract structured knowledge from a piece of content (idea, blog, newsletter, product) using ONLY the provided web search results. You never invent products, prices, numbers, or quotes — if evidence is thin, say so and mark confidence low.

Sources are provided as a numbered list with ids (s1, s2, ...). Cite source ids everywhere evidence exists. It is fine for a section to be empty or thin — an honest gap beats a fabricated claim.

Respond ONLY with valid JSON (no markdown fences) in exactly this shape:
{
  "title": "<name of the idea/product>",
  "oneLiner": "<what it is, one sentence>",
  "summary": "<4-8 sentence executive summary of everything learned: market, demand, competition, gaps>",
  "features": [{ "feature": "<what it does / should do>", "evidence": "<why, grounded in content or sources>", "sourceIds": [] }],
  "competitors": [{ "name": "<exact product name from sources>", "url": "", "platform": "<web|saas|ios|android|desktop|open-source>", "pricing": "<only if a source states it>", "description": "<one line>", "strengths": [], "weaknesses": [], "sourceIds": [] }],
  "painPoints": [{ "theme": "<recurring complaint, e.g. 'slow support'>", "who": "<which users>", "evidence": ["<near-verbatim quote or observation from sources>"], "severity": "<low|medium|high>", "opportunity": "<how a new entrant could exploit it>", "sourceIds": [] }],
  "marketGap": { "description": "<the specific unserved need or underserved segment>", "evidence": "<what supports this>", "opportunity": "<what a focused new entrant could do>", "sourceIds": [] },
  "customers": [{ "segment": "<specific customer segment>", "needs": "<what they need>", "willingnessToPay": "<low|medium|high + note>", "whereTheyHangOut": "<communities/platforms>", "sourceIds": [] }],
  "trends": [{ "signal": "<concrete signal, e.g. 'rising search interest', 'new funding wave'>", "interpretation": "<what it means>", "sourceIds": [] }],
  "similarBets": [{ "company": "<real company from sources>", "whatTheyDo": "", "stage": "<best-known stage>", "outcome": "<died|grew|acquired|pivoted|alive>", "lesson": "<what to learn from them>", "sourceIds": [] }],
  "penetration": { "beachhead": "<the narrow first segment to win>", "channels": ["<2-4 concrete acquisition channels>"], "rationale": "<why this entry path>" },
  "pricing": { "benchmark": { "range": "<e.g. '$4-$12/mo'>", "median": "<e.g. '$8/mo'>", "notes": "<how derived; say if thin>" }, "recommendation": "<concrete pricing recommendation>", "sourceIds": [] },
  "positioning": { "statement": "<'X for Y, unlike Z' one-liner>", "differentiators": ["<2-4 concrete differentiators grounded in the gaps>"] },
  "wedge": { "wedge": "<ONE sharp angle to lead with>", "why": "<why it wins, tied to pain points/gaps>" },
  "risks": ["<3-5 honest risks, including idea-killing ones>"],
  "sources": [{ "id": "<sN>", "title": "", "url": "" }]
}

Rules:
- competitors: 3-8 real products found in the results; exact names/URLs; empty arrays beat speculation.
- painPoints: only themes supported by evidence; 2-6 themes, fewer well-evidenced beats many weak.
- customers: infer distinct segments (from the content and the sources); 1-4.
- sources: list every source you actually cited.`;

const ANGLES_SYSTEM = `You are a viral content strategist. You take a knowledge report (market research with cited sources) and mine it for as many genuinely DISTINCT content angles as possible. Angles become social posts, so each must be a self-contained take a reader can react to.

Systematically comb EVERY section of the knowledge: each pain point, each competitor weakness, each trend, each pricing observation, each similar bet (story!), the market gap, the wedge, the positioning, the risks, the customer segments. Different sections usually yield different angles.

Respond ONLY with valid JSON (no markdown fences) in exactly this shape:
{
  "angles": [
    {
      "title": "<short angle name>",
      "hook": "<one scroll-stopping first line for a post from this angle>",
      "rationale": "<why this angle can go viral: what emotion/reaction it drives and which knowledge it leverages>",
      "facts": ["<specific supporting facts: quotes, numbers, competitor names, outcomes — copied from the knowledge, never invented>"],
      "formats": ["<1-3 format names from the allowed lists below>"],
      "platformFit": "<${PLATFORM_KEYS.join('|')}|both>"
    }
  ]
}

Allowed formats:
${PLATFORM_KEYS.map((k) => `- ${k}: ${FORMAT_NAMES[k].join(', ')}`).join('\n')}

Rules:
- Aim for maximum COUNT and maximum DIVERSITY — no two angles with the same core claim or emotion.
- Every fact must come from the provided knowledge. Never invent statistics or quotes.
- An angle is a TAKE, not a topic: "Everyone thinks Notion is a productivity tool. Actually it's a database most people never learn." not "Notion tips".
- At least one contrarian angle, one story/lesson angle (from similar bets), one pain-point angle, one pricing/value angle, one timing/trend angle — when the knowledge supports them.`;

// ---------------------------------------------------------------- helpers

function buildParsePrompt(text) {
  return `CONTENT TO ANALYZE:\n"""\n${text}\n"""`;
}

function buildSynthesisPrompt(text, brief, sources) {
  const sourceList = sources
    .map((s, i) => `s${i + 1}: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}`)
    .join('\n\n');

  return [
    `ORIGINAL CONTENT (idea/blog/newsletter/product):\n"""\n${text}\n"""`,
    `RESEARCH BRIEF:\n${JSON.stringify(
      {
        name: brief.name,
        oneLiner: brief.oneLiner,
        category: brief.category,
        targetCustomer: brief.targetCustomer,
        features: brief.features,
      },
      null,
      2
    )}`,
    `WEB SEARCH RESULTS (your only external evidence):\n\n${sourceList}`,
  ].join('\n\n');
}

function buildAnglesPrompt(report, count) {
  // Trim the report for the prompt: keep everything except long source snippets
  const trimmed = {
    title: report.title,
    oneLiner: report.oneLiner,
    summary: report.summary,
    features: report.features,
    competitors: report.competitors,
    painPoints: report.painPoints,
    marketGap: report.marketGap,
    customers: report.customers,
    trends: report.trends,
    similarBets: report.similarBets,
    penetration: report.penetration,
    pricing: report.pricing,
    positioning: report.positioning,
    wedge: report.wedge,
    risks: report.risks,
    sources: (report.sources || []).map((s) => ({ id: s.id, title: s.title, url: s.url })),
  };

  return `KNOWLEDGE REPORT:\n${JSON.stringify(trimmed, null, 2)}\n\nGenerate ${count} distinct content angles from this knowledge.`;
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// Defensive normalization so the frontend can render any report without crashing
function normalizeReport(parsed, sources, brief) {
  const srcIds = new Set(sources.map((_, i) => `s${i + 1}`));
  const ids = (arr) => asArray(arr).filter((id) => typeof id === 'string' && srcIds.has(id));

  return {
    title: parsed.title || brief.name || 'Untitled',
    oneLiner: parsed.oneLiner || brief.oneLiner || '',
    summary: parsed.summary || '',
    features: asArray(parsed.features).map((f) => ({
      feature: f?.feature || String(f),
      evidence: f?.evidence || '',
      sourceIds: ids(f?.sourceIds),
    })),
    competitors: asArray(parsed.competitors).map((c) => ({
      name: c?.name || '',
      url: c?.url || '',
      platform: c?.platform || 'web',
      pricing: c?.pricing || null,
      description: c?.description || '',
      strengths: asArray(c?.strengths),
      weaknesses: asArray(c?.weaknesses),
      sourceIds: ids(c?.sourceIds),
    })),
    painPoints: asArray(parsed.painPoints).map((p) => ({
      theme: p?.theme || '',
      who: p?.who || '',
      evidence: asArray(p?.evidence),
      severity: ['low', 'medium', 'high'].includes(p?.severity) ? p.severity : 'medium',
      opportunity: p?.opportunity || '',
      sourceIds: ids(p?.sourceIds),
    })),
    marketGap: {
      description: asObject(parsed.marketGap).description || '',
      evidence: asObject(parsed.marketGap).evidence || '',
      opportunity: asObject(parsed.marketGap).opportunity || '',
      sourceIds: ids(asObject(parsed.marketGap).sourceIds),
    },
    customers: asArray(parsed.customers).map((c) => ({
      segment: c?.segment || '',
      needs: c?.needs || '',
      willingnessToPay: c?.willingnessToPay || '',
      whereTheyHangOut: c?.whereTheyHangOut || '',
      sourceIds: ids(c?.sourceIds),
    })),
    trends: asArray(parsed.trends).map((t) => ({
      signal: t?.signal || '',
      interpretation: t?.interpretation || '',
      sourceIds: ids(t?.sourceIds),
    })),
    similarBets: asArray(parsed.similarBets).map((b) => ({
      company: b?.company || '',
      whatTheyDo: b?.whatTheyDo || '',
      stage: b?.stage || '',
      outcome: ['died', 'grew', 'acquired', 'pivoted', 'alive'].includes(b?.outcome) ? b.outcome : 'alive',
      lesson: b?.lesson || '',
      sourceIds: ids(b?.sourceIds),
    })),
    penetration: {
      beachhead: asObject(parsed.penetration).beachhead || '',
      channels: asArray(asObject(parsed.penetration).channels),
      rationale: asObject(parsed.penetration).rationale || '',
    },
    pricing: {
      benchmark: {
        range: asObject(asObject(parsed.pricing).benchmark).range || '',
        median: asObject(asObject(parsed.pricing).benchmark).median || '',
        notes: asObject(asObject(parsed.pricing).benchmark).notes || '',
      },
      recommendation: asObject(parsed.pricing).recommendation || '',
      sourceIds: ids(asObject(parsed.pricing).sourceIds),
    },
    positioning: {
      statement: asObject(parsed.positioning).statement || '',
      differentiators: asArray(asObject(parsed.positioning).differentiators),
    },
    wedge: {
      wedge: asObject(parsed.wedge).wedge || '',
      why: asObject(parsed.wedge).why || '',
    },
    risks: asArray(parsed.risks).map(String),
    sources: sources.map((s, i) => ({ id: `s${i + 1}`, title: s.title, url: s.url })),
  };
}

function normalizeAngles(parsed) {
  const validFormats = new Set(Object.values(FORMAT_NAMES).flat());
  return asArray(parsed.angles)
    .filter((a) => a && a.title)
    .map((a) => ({
      title: a.title,
      hook: a.hook || '',
      rationale: a.rationale || '',
      facts: asArray(a.facts).map(String).slice(0, 6),
      formats: asArray(a.formats)
        .map(String)
        .filter((f) => validFormats.has(f))
        .slice(0, 3),
      platformFit: [...PLATFORM_KEYS, 'both'].includes(a.platformFit) ? a.platformFit : 'both',
    }));
}

// ---------------------------------------------------------------- pipeline

export async function runKnowledgeExtraction(text, { onUpdate = () => {} } = {}) {
  const apiKey = requireTavily();

  // Stage 1: parse the content into a research brief
  onUpdate('parsing');
  const brief = await chatJSON({
    system: PARSE_SYSTEM,
    prompt: buildParsePrompt(text),
    temperature: 0.3,
  });
  if (!brief || !Array.isArray(brief.searchQueries) || !brief.searchQueries.length) {
    throw new Error('AI could not parse the content into a research brief.');
  }

  // Stage 2: web sweep — run the brief's queries in parallel, merge + dedupe
  onUpdate('researching');
  const queries = brief.searchQueries.slice(0, 8);
  const sweeps = await Promise.all(
    queries.map(async (q) => {
      try {
        return await tavilySearch(apiKey, q);
      } catch (err) {
        // one failed query should not kill the run
        console.warn(`[research] query failed: "${q}" — ${err.message}`);
        return [];
      }
    })
  );
  const sources = mergeSweepResults(sweeps);
  if (!sources.length) {
    throw new Error('Web research returned no results — try rephrasing the content or idea.');
  }

  // Stage 3: synthesize the knowledge report
  onUpdate('synthesizing');
  const parsed = await chatJSON({
    system: SYNTHESIS_SYSTEM,
    prompt: buildSynthesisPrompt(text, brief, sources),
    temperature: 0.4,
  });
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI returned an invalid knowledge report.');
  }

  onUpdate('done');
  return normalizeReport(parsed, sources, brief);
}

export async function generateAngles(report, count = 15) {
  const parsed = await chatJSON({
    system: ANGLES_SYSTEM,
    prompt: buildAnglesPrompt(report, count),
    temperature: 0.9,
  });
  const angles = normalizeAngles(parsed);
  if (!angles.length) throw new Error('AI returned no angles.');
  return angles;
}
