import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

function env(key) {
  return process.env[key] && process.env[key].trim() ? process.env[key].trim() : undefined;
}

// Ollama serves its OpenAI-compatible API under /v1
function ollamaUrl(raw) {
  const base = (raw || 'http://localhost:11434').replace(/\/+$/, '');
  return /\/v1$/.test(base) ? base : `${base}/v1`;
}

export const AI_PROVIDERS = ['openai', 'openrouter', 'opencodego', 'ollama'];

export const config = {
  port: Number(env('PORT') || 3000),
  ai: {
    // .env AI_PROVIDER is the single source of truth; the Settings
    // dropdown rewrites that same value via setAiProvider() below.
    provider: AI_PROVIDERS.includes(env('AI_PROVIDER')) ? env('AI_PROVIDER') : 'openai',
    providers: {
      openai: {
        name: 'OpenAI',
        apiKey: env('OPENAI_API_KEY'),
        model: env('OPENAI_MODEL') || 'gpt-4o-mini',
        baseUrl: undefined,
      },
      openrouter: {
        name: 'OpenRouter',
        apiKey: env('OPENROUTER_API_KEY'),
        model: env('OPENROUTER_MODEL') || 'openai/gpt-4o-mini',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      opencodego: {
        name: 'OpenCode Go',
        apiKeyEnv: 'OPENCODE_API_KEY',
        apiKey: env('OPENCODE_API_KEY') || env('OPENCODE_GO_API_KEY'),
        model: env('OPENCODE_GO_MODEL') || 'glm-5.3-flash',
        baseUrl: (env('OPENCODE_GO_BASE_URL') || 'https://opencode.ai/zen/go/v1').replace(/\/$/, ''),
      },
      ollama: {
        name: 'Ollama (local)',
        apiKey: env('OLLAMA_API_KEY') || 'ollama', // Ollama ignores auth; SDK requires a non-empty key
        model: env('OLLAMA_MODEL') || 'llama3.1',
        baseUrl: ollamaUrl(env('OLLAMA_BASE_URL')),
      },
    },
  },
  reddit: {
    clientId: env('REDDIT_CLIENT_ID'),
    clientSecret: env('REDDIT_CLIENT_SECRET'),
    username: env('REDDIT_USERNAME'),
    password: env('REDDIT_PASSWORD'),
  },
  x: {
    bearerToken: env('X_BEARER_TOKEN'),
  },
  tavily: {
    apiKey: env('TAVILY_API_KEY'),
  },
};

// Persist the provider choice: runtime config + .env file (single source of
// truth, so the UI dropdown and manual .env edits can never disagree).
export function setAiProvider(provider) {
  if (!AI_PROVIDERS.includes(provider)) {
    const err = new Error(`Unknown provider "${provider}". Valid: ${AI_PROVIDERS.join(', ')}`);
    err.status = 400;
    throw err;
  }

  config.ai.provider = provider;
  process.env.AI_PROVIDER = provider;

  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const line = `AI_PROVIDER=${provider}`;
  if (/^[ \t]*AI_PROVIDER=.*$/m.test(content)) {
    content = content.replace(/^[ \t]*AI_PROVIDER=.*$/m, line);
  } else {
    content = content.trimEnd() + (content.trim() ? '\n' : '') + line + '\n';
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}