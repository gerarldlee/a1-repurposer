const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------------- utilities

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------------------------------------------------------- tabs

$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${btn.dataset.tab}`));
    if (btn.dataset.tab === 'queue') loadQueue();
    if (btn.dataset.tab === 'schedule') loadSchedule();
    if (btn.dataset.tab === 'settings') loadSettings();
    if (btn.dataset.tab === 'knowledge') loadKnowledgeList();
    if (btn.dataset.tab === 'angles') loadAnglesTab();
  });
});

function switchTab(name) {
  const btn = $(`.tab-btn[data-tab="${name}"]`);
  if (btn) btn.click();
}

// ---------------------------------------------------------------- create

// Mirrors PLATFORMS in server/ai.js (platform key -> display label).
const PLATFORMS = [
  { v: 'x', t: 'X' },
  { v: 'reddit', t: 'Reddit' },
  { v: 'tiktok', t: 'TikTok' },
  { v: 'yt_shorts', t: 'YT Shorts' },
  { v: 'instagram', t: 'Instagram' },
];
const VIDEO_PLATFORMS = ['tiktok', 'yt_shorts'];
// Platforms whose posts carry a separate hook/title line.
const TITLE_PLATFORMS = ['reddit', 'tiktok', 'yt_shorts', 'instagram'];

const platformLabel = (key) => PLATFORMS.find((p) => p.v === key)?.t || key;

function platform() {
  return document.querySelector('input[name="platform"]:checked').value;
}

$$('input[name="platform"]').forEach((r) =>
  r.addEventListener('change', () => {
    $('#subreddit-row').classList.toggle('hidden', platform() !== 'reddit');
    $('#video-note').classList.toggle('hidden', !VIDEO_PLATFORMS.includes(platform()));
  })
);

$('#generate-btn').addEventListener('click', async () => {
  const btn = $('#generate-btn');
  const idea = $('#idea').value.trim();
  if (!idea) return toast('Paste your idea or content first.', true);

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  $('#gen-hint').textContent = 'The AI is crafting viral angles — this takes a few seconds.';
  try {
    const data = await api('/api/generate', {
      method: 'POST',
      body: { idea, platform: platform(), subreddit: $('#subreddit').value.trim(), count: Number($('#count').value) },
    });
    renderVariants(data.posts);
    toast(`Generated ${data.posts.length} variants. Pick your favorites.`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Generate viral ideas';
    $('#gen-hint').textContent = 'AI will create multiple angles in viral formats popular on your chosen platform.';
  }
});

function renderVariants(posts) {
  const wrap = $('#variants');
  wrap.innerHTML = '<h2>2. Pick, edit, approve</h2>';
  posts.forEach((p) => wrap.appendChild(variantCard(p, { allowSchedule: true })));
}

function variantCard(post, { allowSchedule }) {
  const el = document.createElement('div');
  el.className = 'variant';
  el.dataset.id = post.id;
  el.innerHTML = `
    <span class="format-tag">${post.format || post.platform}</span>
    ${post.subreddit ? `<span class="format-tag">r/${post.subreddit}</span>` : ''}
    <span class="status-pill status-${post.status}">${post.status}</span>
    <div class="content"></div>
    <div class="image-area"></div>
    <div class="actions"></div>
    <div class="extra"></div>
  `;

  const content = el.querySelector('.content');
  const imageArea = el.querySelector('.image-area');
  const actions = el.querySelector('.actions');
  const extra = el.querySelector('.extra');

  let editing = false;

  function renderContent() {
    content.innerHTML = '';
    if (editing) {
      if (TITLE_PLATFORMS.includes(post.platform)) {
        const t = document.createElement('textarea');
        t.className = 'edit-title';
        t.rows = 2;
        t.value = post.title || '';
        t.placeholder = 'Title';
        t.addEventListener('input', () => (post.title = t.value));
        content.appendChild(t);
      }
      const b = document.createElement('textarea');
      b.className = 'edit-body';
      b.rows = Math.max(4, (post.body || '').split('\n').length + 1);
      b.value = post.body || '';
      b.placeholder = 'Post body';
      b.addEventListener('input', () => (post.body = b.value));
      content.appendChild(b);
    } else {
      if (post.title) {
        const t = document.createElement('div');
        t.className = 'title';
        t.textContent = post.title;
        content.appendChild(t);
      }
      const b = document.createElement('div');
      b.className = 'body';
      b.textContent = post.body;
      content.appendChild(b);
    }
  }

  function renderActions() {
    actions.innerHTML = '';

    const mk = (label, cls, fn) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (cls) btn.className = cls;
      btn.addEventListener('click', fn);
      actions.appendChild(btn);
      return btn;
    };

    if (['draft', 'rejected', 'failed'].includes(post.status)) {
      mk(editing ? '💾 Save' : '✏️ Edit', null, async () => {
        if (editing) {
          try {
            const data = await api(`/api/posts/${post.id}`, { method: 'PATCH', body: { title: post.title, body: post.body } });
            Object.assign(post, data.post);
          } catch (err) {
            return toast(err.message, true);
          }
        }
        editing = !editing;
        renderContent();
        renderActions();
      });
      mk('🔄 Regenerate', null, async (e) => {
        const btn = e.target;
        btn.disabled = true;
        try {
          const data = await api('/api/generate', {
            method: 'POST',
            body: { idea: post.source_idea, platform: post.platform, subreddit: post.subreddit, count: 1 },
          });
          const fresh = data.posts[0];
          Object.assign(post, { format: fresh.format, title: fresh.title, body: fresh.body });
          await api(`/api/posts/${fresh.id}`, { method: 'DELETE' }); // drop the temp row; fields already copied
          renderContent();
          renderMedia();
        } catch (err) {
          toast(err.message, true);
        } finally {
          btn.disabled = false;
        }
      });
      mk('✅ Approve', 'primary', async () => {
        try {
          const data = await api(`/api/posts/${post.id}/approve`, { method: 'POST' });
          Object.assign(post, data.post);
          renderActions();
          toast('Approved! Now schedule it below.');
          renderSchedule();
        } catch (err) {
          toast(err.message, true);
        }
      });
      mk('🗑 Delete', 'danger', async () => {
        try {
          await api(`/api/posts/${post.id}`, { method: 'DELETE' });
          el.remove();
        } catch (err) {
          toast(err.message, true);
        }
      });
    }

    if (post.status === 'approved') renderSchedule();
    if (post.status === 'scheduled') mk('↩️ Unschedule', null, unschedule);
    if (post.status === 'posted') renderResult();
    if (post.status === 'failed') {
      const err = document.createElement('div');
      err.className = 'error-text';
      err.textContent = post.error || 'Unknown error';
      extra.appendChild(err);
      mk('Retry', 'primary', async () => postNow(post.id, el));
    }
  }

  function renderSchedule() {
    if (!allowSchedule && post.status !== 'approved') return;
    const wrap = document.createElement('span');
    wrap.className = 'schedule-wrap';
    wrap.style.display = 'inline-flex';
    wrap.style.gap = '8px';
    wrap.style.alignItems = 'center';

    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'schedule-input';
    input.value = toLocalInput(new Date(Date.now() + 3600_000));
    wrap.appendChild(input);

    const schedBtn = document.createElement('button');
    schedBtn.textContent = '🗓 Schedule';
    schedBtn.className = 'primary';
    schedBtn.addEventListener('click', async () => {
      if (!input.value) return toast('Pick a date and time.', true);
      try {
        const data = await api(`/api/posts/${post.id}/schedule`, { method: 'POST', body: { scheduled_at: new Date(input.value).toISOString() } });
        Object.assign(post, data.post);
        toast(`Scheduled for ${fmtDate(post.scheduled_at)}`);
        renderActions();
      } catch (err) {
        toast(err.message, true);
      }
    });
    wrap.appendChild(schedBtn);

    const nowBtn = document.createElement('button');
    nowBtn.textContent = '🚀 Post now';
    nowBtn.addEventListener('click', async (e) => {
      e.target.disabled = true;
      await postNow(post.id, el);
    });
    wrap.appendChild(nowBtn);

    actions.appendChild(wrap);
  }

  function renderResult() {
    if (post.result_url) {
      const link = document.createElement('div');
      link.className = 'result-link';
      link.innerHTML = `<a href="${post.result_url}" target="_blank" rel="noopener">${post.result_url}</a>`;
      extra.appendChild(link);
    }
  }

  async function unschedule() {
    try {
      const data = await api(`/api/posts/${post.id}`, { method: 'PATCH', body: { status: 'approved' } });
      Object.assign(post, data.post);
      renderActions();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderMedia() {
    imageArea.innerHTML = '';
    if (post.platform === 'x' || post.platform === 'instagram') renderImage();
    if (VIDEO_PLATFORMS.includes(post.platform) || post.platform === 'instagram') renderVideo();
  }

  function renderImage() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
    fileInput.className = 'hidden';

    if (post.image_path) {
      const wrap = document.createElement('div');
      wrap.className = 'image-preview';
      const img = document.createElement('img');
      img.src = post.image_path;
      img.alt = 'Attached screenshot';
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕ Remove image';
      removeBtn.className = 'danger';
      removeBtn.addEventListener('click', async () => {
        try {
          const data = await api(`/api/posts/${post.id}/image`, { method: 'DELETE' });
          Object.assign(post, data.post);
          renderMedia();
        } catch (err) {
          toast(err.message, true);
        }
      });
      wrap.appendChild(img);
      wrap.appendChild(removeBtn);
      imageArea.appendChild(wrap);
    } else {
      const attachBtn = document.createElement('button');
      const photoFormat = post.format === 'screenshot' || post.format === 'photo_caption';
      attachBtn.textContent = photoFormat ? '📸 Attach photo (required for this format)' : '📸 Attach image';
      if (photoFormat) attachBtn.classList.add('primary');
      attachBtn.addEventListener('click', () => fileInput.click());
      imageArea.appendChild(attachBtn);
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) return toast('Image must be 5MB or less (X limit).', true);
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read the file'));
          reader.readAsDataURL(file);
        });
        const data = await api(`/api/posts/${post.id}/image`, { method: 'POST', body: { image: dataUrl } });
        Object.assign(post, data.post);
        renderMedia();
        toast('Image attached.');
      } catch (err) {
        toast(err.message, true);
      } finally {
        fileInput.value = '';
      }
    });

    imageArea.appendChild(fileInput);
  }

  function renderVideo() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/mp4,video/quicktime,video/webm,video/x-m4v';
    fileInput.className = 'hidden';

    if (post.media_path) {
      const wrap = document.createElement('div');
      wrap.className = 'image-preview';
      const video = document.createElement('video');
      video.src = post.media_path;
      video.controls = true;
      video.preload = 'metadata';
      video.style.maxWidth = '260px';
      const name = document.createElement('div');
      name.className = 'hint';
      name.textContent = post.media_path.split('/').pop();
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕ Remove video';
      removeBtn.className = 'danger';
      removeBtn.addEventListener('click', async () => {
        try {
          const data = await api(`/api/posts/${post.id}/media`, { method: 'DELETE' });
          Object.assign(post, data.post);
          renderMedia();
        } catch (err) {
          toast(err.message, true);
        }
      });
      wrap.appendChild(video);
      wrap.appendChild(name);
      wrap.appendChild(removeBtn);
      imageArea.appendChild(wrap);
    } else {
      const attachBtn = document.createElement('button');
      attachBtn.textContent = `🎬 Attach video (required to post to ${platformLabel(post.platform)})`;
      attachBtn.className = 'primary';
      attachBtn.addEventListener('click', () => fileInput.click());
      imageArea.appendChild(attachBtn);
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 200 * 1024 * 1024) return toast('Video must be 200MB or less.', true);
      try {
        // Raw bytes, not base64: the JSON api() helper would bloat a video by ~33%.
        const res = await fetch(`/api/posts/${post.id}/media`, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'video/mp4' },
          body: file,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
        Object.assign(post, data.post);
        renderMedia();
        toast('Video attached.');
      } catch (err) {
        toast(err.message, true);
      } finally {
        fileInput.value = '';
      }
    });

    imageArea.appendChild(fileInput);
  }

  renderContent();
  renderMedia();
  renderActions();
  return el;
}

async function postNow(id, el) {
  try {
    const data = await api(`/api/posts/${id}/post-now`, { method: 'POST' });
    toast('Posted!');
    if (el) {
      el.remove();
      loadQueue();
    }
    return data.post;
  } catch (err) {
    toast(err.message, true);
    if (el) {
      el.remove();
      loadQueue();
    }
  }
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------- knowledge

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const KNOWLEDGE_SECTIONS = [
  { key: 'summary', label: 'Summary' },
  { key: 'features', label: 'Features' },
  { key: 'competitors', label: 'Competitors' },
  { key: 'painPoints', label: 'Pain Points' },
  { key: 'marketGap', label: 'Market Gap' },
  { key: 'customers', label: 'Customers' },
  { key: 'trends', label: 'Trends' },
  { key: 'similarBets', label: 'Similar Bets' },
  { key: 'penetration', label: 'Penetration' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'positioning', label: 'Positioning' },
  { key: 'wedge', label: 'Wedge' },
  { key: 'risks', label: 'Risks' },
  { key: 'sources', label: 'Sources' },
];

const KNOWLEDGE_STAGE_LABELS = {
  parsing: '📄 Parsing your content…',
  researching: '🌐 Researching the web — competitors, complaints, trends…',
  synthesizing: '🧠 Synthesizing the knowledge report…',
  done: '✅ Done',
};

let knowledgePollTimer = null;
let currentKnowledgeId = null;
let activeSubTab = 'summary';

function stopKnowledgePoll() {
  if (knowledgePollTimer) {
    clearInterval(knowledgePollTimer);
    knowledgePollTimer = null;
  }
}

$('#knowledge-extract-btn').addEventListener('click', async () => {
  const btn = $('#knowledge-extract-btn');
  const text = $('#knowledge-text').value.trim();
  if (!text) return toast('Paste your idea, content, or product first.', true);

  btn.disabled = true;
  btn.textContent = '⏳ Starting…';
  try {
    const data = await api('/api/knowledge', { method: 'POST', body: { text } });
    toast('Knowledge extraction started — watch the progress below.');
    loadKnowledgeList();
    startKnowledgePoll(data.knowledge.id);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Extract knowledge';
  }
});

function startKnowledgePoll(id) {
  stopKnowledgePoll();
  const progress = $('#knowledge-progress');
  progress.classList.remove('hidden');
  const hint = $('#knowledge-hint');

  const tick = async () => {
    let data;
    try {
      data = await api(`/api/knowledge/${id}`);
    } catch (err) {
      stopKnowledgePoll();
      progress.innerHTML = `<span class="error-text">${err.message}</span>`;
      return;
    }
    const k = data.knowledge;
    if (k.status === 'running') {
      progress.innerHTML = `<span class="spinner"></span> ${KNOWLEDGE_STAGE_LABELS[k.stage] || 'Working…'}`;
      hint.textContent = `Extracting: ${k.stage}`;
      return;
    }
    stopKnowledgePoll();
    hint.textContent = 'Takes ~30-60s: parse → web research → synthesis.';
    if (k.status === 'failed') {
      progress.innerHTML = `<span class="error-text">❌ ${k.error || 'Extraction failed.'}</span>`;
      toast(k.error || 'Knowledge extraction failed.', true);
    } else {
      progress.innerHTML = '<span class="ok-text">✅ Knowledge report ready.</span>';
      setTimeout(() => progress.classList.add('hidden'), 3000);
      currentKnowledgeId = k.id;
      renderKnowledgeReport(k);
    }
    loadKnowledgeList();
    refreshKnowledgeSelect();
  };

  tick();
  knowledgePollTimer = setInterval(tick, 2000);
}

async function loadKnowledgeList() {
  const wrap = $('#knowledge-list');
  try {
    const data = await api('/api/knowledge');
    if (!data.knowledge.length) {
      wrap.innerHTML = '<p class="empty">No knowledge reports yet. Extract one above.</p>';
      return;
    }
    wrap.innerHTML = '';
    data.knowledge.forEach((k) => {
      const row = el('div', 'knowledge-row');
      const main = el('button', 'knowledge-row-main');
      const title = el('span', 'knowledge-row-title', k.title || `Report #${k.id}`);
      const status =
        k.status === 'running'
          ? el('span', 'status-pill status-running', KNOWLEDGE_STAGE_LABELS[k.stage] ? `⏳ ${k.stage}` : 'running')
          : k.status === 'failed'
            ? el('span', 'status-pill status-failed', 'failed')
            : el('span', 'status-pill status-posted', 'ready');
      main.appendChild(title);
      main.appendChild(status);
      main.addEventListener('click', async () => {
        try {
          const full = await api(`/api/knowledge/${k.id}`);
          if (full.knowledge.status !== 'done') {
            if (full.knowledge.status === 'running') startKnowledgePoll(k.id);
            return toast('This extraction is not finished yet.', true);
          }
          currentKnowledgeId = k.id;
          renderKnowledgeReport(full.knowledge);
          $('#knowledge-report').scrollIntoView({ behavior: 'smooth' });
        } catch (err) {
          toast(err.message, true);
        }
      });
      row.appendChild(main);
      const del = el('button', 'danger', '🗑');
      del.title = 'Delete report';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api(`/api/knowledge/${k.id}`, { method: 'DELETE' });
          if (currentKnowledgeId === k.id) {
            currentKnowledgeId = null;
            $('#knowledge-report').classList.add('hidden');
          }
          loadKnowledgeList();
          refreshKnowledgeSelect();
          toast('Report deleted.');
        } catch (err) {
          toast(err.message, true);
        }
      });
      row.appendChild(del);
      wrap.appendChild(row);
    });
  } catch (err) {
    wrap.innerHTML = `<p class="error-text">${err.message}</p>`;
  }
}

function sourceChip(id, sources) {
  const s = sources.get(id);
  const chip = el('a', 'source-chip', id);
  if (s) {
    chip.href = s.url;
    chip.target = '_blank';
    chip.rel = 'noopener';
    chip.title = s.title;
  }
  return chip;
}

function factCard(header, lines, { chips } = {}) {
  const card = el('div', 'mini-card');
  if (header) card.appendChild(el('p', 'mini-card-title', header));
  (Array.isArray(lines) ? lines : [lines]).filter(Boolean).forEach((line) => {
    if (typeof line === 'string') card.appendChild(el('p', 'mini-card-line', line));
  });
  if (chips && chips.length) {
    const wrap = el('div', 'chip-row');
    chips.forEach((id) => wrap.appendChild(sourceChip(id, sourcesMap)));
    card.appendChild(wrap);
  }
  return card;
}

let sourcesMap = new Map();

function sectionShell(label, description) {
  const shell = el('div');
  shell.appendChild(el('h3', null, label));
  if (description) shell.appendChild(el('p', 'hint', description));
  const body = el('div', 'section-body');
  shell.appendChild(body);
  return shell;
}

function emptyNote() {
  return el('p', 'empty', 'Not enough evidence for this section.');
}

function renderKnowledgeSection(key, r) {
  const sources = sourcesMap;
  switch (key) {
    case 'summary': {
      const shell = sectionShell('Summary', 'Everything learned, in one place.');
      const body = shell.querySelector('.section-body');
      body.appendChild(el('p', 'summary-text', r.summary || 'No summary.'));
      const meta = el('div', 'chip-row');
      if (r.oneLiner) meta.appendChild(el('span', 'format-tag', r.oneLiner));
      body.appendChild(meta);
      return shell;
    }
    case 'features': {
      const shell = sectionShell('Features', 'What the content/product does — and what evidence supports it.');
      const body = shell.querySelector('.section-body');
      if (!r.features.length) body.appendChild(emptyNote());
      r.features.forEach((f) => body.appendChild(factCard(f.feature, [f.evidence], { chips: f.sourceIds })));
      return shell;
    }
    case 'competitors': {
      const shell = sectionShell('Competitors', 'Real products found in the sources.');
      const body = shell.querySelector('.section-body');
      if (!r.competitors.length) body.appendChild(emptyNote());
      r.competitors.forEach((c) => {
        const card = el('div', 'mini-card');
        const head = el('div', 'mini-card-head');
        const nameEl = c.url ? el('a', 'mini-card-title', c.name) : el('p', 'mini-card-title', c.name);
        if (c.url) {
          nameEl.href = c.url;
          nameEl.target = '_blank';
          nameEl.rel = 'noopener';
        }
        head.appendChild(nameEl);
        const tags = el('span', 'chip-row');
        tags.appendChild(el('span', 'format-tag', c.platform));
        if (c.pricing) tags.appendChild(el('span', 'format-tag', c.pricing));
        head.appendChild(tags);
        card.appendChild(head);
        if (c.description) card.appendChild(el('p', 'mini-card-line', c.description));
        if (c.strengths.length) card.appendChild(el('p', 'mini-card-line', `✅ ${c.strengths.join(' · ')}`));
        if (c.weaknesses.length) card.appendChild(el('p', 'mini-card-line', `⚠️ ${c.weaknesses.join(' · ')}`));
        const chipRow = el('div', 'chip-row');
        c.sourceIds.forEach((id) => chipRow.appendChild(sourceChip(id, sources)));
        if (chipRow.children.length) card.appendChild(chipRow);
        body.appendChild(card);
      });
      return shell;
    }
    case 'painPoints': {
      const shell = sectionShell('Pain Points', 'Recurring complaints — each is an entry point.');
      const body = shell.querySelector('.section-body');
      if (!r.painPoints.length) body.appendChild(emptyNote());
      r.painPoints.forEach((p) => {
        const card = el('div', 'mini-card');
        const head = el('div', 'mini-card-head');
        head.appendChild(el('p', 'mini-card-title', p.theme));
        head.appendChild(el('span', `severity severity-${p.severity}`, p.severity));
        card.appendChild(head);
        if (p.who) card.appendChild(el('p', 'mini-card-line', `Who: ${p.who}`));
        p.evidence.forEach((q) => card.appendChild(el('p', 'quote', `“${q}”`)));
        if (p.opportunity) card.appendChild(el('p', 'mini-card-line', `💡 Opportunity: ${p.opportunity}`));
        const chipRow = el('div', 'chip-row');
        p.sourceIds.forEach((id) => chipRow.appendChild(sourceChip(id, sources)));
        if (chipRow.children.length) card.appendChild(chipRow);
        body.appendChild(card);
      });
      return shell;
    }
    case 'marketGap': {
      const shell = sectionShell('Market Gap', 'The unserved need.');
      const body = shell.querySelector('.section-body');
      if (!r.marketGap.description) body.appendChild(emptyNote());
      else {
        body.appendChild(factCard(null, [`Gap: ${r.marketGap.description}`, `Evidence: ${r.marketGap.evidence}`, `💡 Opportunity: ${r.marketGap.opportunity}`], { chips: r.marketGap.sourceIds }));
      }
      return shell;
    }
    case 'customers': {
      const shell = sectionShell('Customers', 'Segments worth winning.');
      const body = shell.querySelector('.section-body');
      if (!r.customers.length) body.appendChild(emptyNote());
      r.customers.forEach((c) => body.appendChild(factCard(c.segment, [`Needs: ${c.needs}`, `Willingness to pay: ${c.willingnessToPay}`, `Where they hang out: ${c.whereTheyHangOut}`], { chips: c.sourceIds })));
      return shell;
    }
    case 'trends': {
      const shell = sectionShell('Trends', 'Market direction signals.');
      const body = shell.querySelector('.section-body');
      if (!r.trends.length) body.appendChild(emptyNote());
      r.trends.forEach((t) => body.appendChild(factCard(t.signal, [t.interpretation], { chips: t.sourceIds })));
      return shell;
    }
    case 'similarBets': {
      const shell = sectionShell('Similar Bets', 'Companies that made adjacent bets — and how it went.');
      const body = shell.querySelector('.section-body');
      if (!r.similarBets.length) body.appendChild(emptyNote());
      r.similarBets.forEach((b) => {
        const card = el('div', 'mini-card');
        const head = el('div', 'mini-card-head');
        head.appendChild(el('p', 'mini-card-title', b.company));
        head.appendChild(el('span', `severity severity-${b.outcome === 'died' ? 'high' : b.outcome === 'grew' || b.outcome === 'acquired' ? 'low' : 'medium'}`, b.outcome));
        card.appendChild(head);
        if (b.whatTheyDo) card.appendChild(el('p', 'mini-card-line', b.whatTheyDo));
        if (b.stage) card.appendChild(el('p', 'mini-card-line', `Stage: ${b.stage}`));
        if (b.lesson) card.appendChild(el('p', 'mini-card-line', `Lesson: ${b.lesson}`));
        const chipRow = el('div', 'chip-row');
        b.sourceIds.forEach((id) => chipRow.appendChild(sourceChip(id, sources)));
        if (chipRow.children.length) card.appendChild(chipRow);
        body.appendChild(card);
      });
      return shell;
    }
    case 'penetration': {
      const shell = sectionShell('Market Penetration Strategy', 'How a new entrant gets in.');
      const body = shell.querySelector('.section-body');
      if (!r.penetration.beachhead) body.appendChild(emptyNote());
      else {
        body.appendChild(factCard(null, [`Beachhead: ${r.penetration.beachhead}`, `Channels: ${r.penetration.channels.join(' · ')}`, r.penetration.rationale]));
      }
      return shell;
    }
    case 'pricing': {
      const shell = sectionShell('Pricing', 'What the market charges — and what to charge.');
      const body = shell.querySelector('.section-body');
      if (!r.pricing.benchmark.range && !r.pricing.recommendation) body.appendChild(emptyNote());
      else {
        body.appendChild(factCard(null, [`Benchmark: ${r.pricing.benchmark.range || '—'} (median ${r.pricing.benchmark.median || '—'})`, r.pricing.benchmark.notes, `💡 Recommendation: ${r.pricing.recommendation}`], { chips: r.pricing.sourceIds }));
      }
      return shell;
    }
    case 'positioning': {
      const shell = sectionShell('Positioning', 'How to be different.');
      const body = shell.querySelector('.section-body');
      if (!r.positioning.statement) body.appendChild(emptyNote());
      else {
        body.appendChild(factCard(null, [r.positioning.statement, ...(r.positioning.differentiators || []).map((d) => `• ${d}`)]));
      }
      return shell;
    }
    case 'wedge': {
      const shell = sectionShell('Wedge', 'The one sharp angle to lead with.');
      const body = shell.querySelector('.section-body');
      if (!r.wedge.wedge) body.appendChild(emptyNote());
      else body.appendChild(factCard(null, [r.wedge.wedge, r.wedge.why]));
      return shell;
    }
    case 'risks': {
      const shell = sectionShell('Risks', 'What could kill it.');
      const body = shell.querySelector('.section-body');
      if (!r.risks.length) body.appendChild(emptyNote());
      else {
        const ul = el('ul', 'risk-list');
        r.risks.forEach((risk) => {
          const li = el('li');
          li.textContent = `⚠️ ${risk}`;
          ul.appendChild(li);
        });
        body.appendChild(ul);
      }
      return shell;
    }
    case 'sources': {
      const shell = sectionShell('Sources', 'Every claim links back to a source.');
      const body = shell.querySelector('.section-body');
      if (!r.sources.length) body.appendChild(emptyNote());
      r.sources.forEach((s) => {
        const a = el('a', 'source-link', `${s.id} — ${s.title}`);
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener';
        body.appendChild(a);
      });
      return shell;
    }
    default:
      return el('p', 'empty', 'Unknown section.');
  }
}

function renderKnowledgeReport(k) {
  const r = k.report;
  sourcesMap = new Map((r.sources || []).map((s) => [s.id, s]));

  const wrap = $('#knowledge-report');
  wrap.classList.remove('hidden');
  wrap.innerHTML = '';

  const header = el('div', 'knowledge-header');
  header.appendChild(el('h2', null, r.title || k.title || 'Knowledge report'));
  if (r.oneLiner) header.appendChild(el('p', 'hint', r.oneLiner));
  const ctaRow = el('div', 'row');
  const cta = el('button', 'primary', '🎯 Generate angles from this knowledge');
  cta.addEventListener('click', () => openAnglesFor(k.id));
  ctaRow.appendChild(cta);
  header.appendChild(ctaRow);
  wrap.appendChild(header);

  const subtabs = el('div', 'subtabs');
  KNOWLEDGE_SECTIONS.forEach((s) => {
    const btn = el('button', `subtab-btn${s.key === activeSubTab ? ' active' : ''}`, s.label);
    btn.addEventListener('click', () => {
      activeSubTab = s.key;
      subtabs.querySelectorAll('.subtab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderActiveSection();
    });
    subtabs.appendChild(btn);
  });
  wrap.appendChild(subtabs);

  const detail = el('div', null);
  detail.id = 'knowledge-detail';
  wrap.appendChild(detail);

  function renderActiveSection() {
    detail.innerHTML = '';
    const section = KNOWLEDGE_SECTIONS.find((s) => s.key === activeSubTab);
    detail.appendChild(renderKnowledgeSection(activeSubTab, r, section));
  }
  renderActiveSection();
}

// ---------------------------------------------------------------- angles

async function refreshKnowledgeSelect() {
  const select = $('#angles-report');
  const previous = select.value;
  let data;
  try {
    data = await api('/api/knowledge');
  } catch {
    return;
  }
  const usable = data.knowledge.filter((k) => k.status === 'done' || k.status === 'running');
  select.innerHTML = '';
  if (!usable.length) {
    const opt = el('option', null, '— extract knowledge first —');
    opt.value = '';
    select.appendChild(opt);
    return;
  }
  usable.forEach((k) => {
    const opt = el('option', null, `${k.status === 'done' ? '' : '⏳ '}${k.title || `Report #${k.id}`}`);
    opt.value = k.id;
    select.appendChild(opt);
  });
  if (previous && usable.some((k) => String(k.id) === previous)) select.value = previous;
}

async function loadAnglesTab() {
  await refreshKnowledgeSelect();
  const id = $('#angles-report').value;
  if (id) await loadAngles(id);
  else $('#angles-list').innerHTML = '<p class="empty">Extract knowledge first (Knowledge tab), then generate angles from it.</p>';
}

function openAnglesFor(knowledgeId) {
  switchTab('angles');
  refreshKnowledgeSelect().then(() => {
    $('#angles-report').value = String(knowledgeId);
    loadAngles(knowledgeId);
  });
}

async function loadAngles(knowledgeId) {
  const wrap = $('#angles-list');
  try {
    const data = await api(`/api/knowledge/${knowledgeId}/angles`);
    if (!data.angles.length) {
      wrap.innerHTML = '<p class="empty">No angles yet for this report — generate some above.</p>';
      return;
    }
    wrap.innerHTML = '';
    data.angles.forEach((a) => wrap.appendChild(angleCard(a)));
  } catch (err) {
    wrap.innerHTML = `<p class="error-text">${err.message}</p>`;
  }
}

$('#angles-generate-btn').addEventListener('click', async () => {
  const btn = $('#angles-generate-btn');
  const id = $('#angles-report').value;
  if (!id) return toast('Extract a knowledge report first.', true);
  const k = await api(`/api/knowledge/${id}`);
  if (k.knowledge.status !== 'done') return toast('That report is still extracting.', true);

  btn.disabled = true;
  btn.textContent = '⏳ Mining angles…';
  try {
    const data = await api(`/api/knowledge/${id}/angles`, {
      method: 'POST',
      body: { count: Number($('#angles-count').value) },
    });
    toast(`Generated ${data.angles.length} angles.`);
    const wrap = $('#angles-list');
    wrap.innerHTML = '';
    data.angles.forEach((a) => wrap.appendChild(angleCard(a)));
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🎯 Generate angles';
  }
});

function angleCard(a) {
  const card = el('div', 'variant angle-card');
  card.dataset.id = a.id;

  const tags = el('div', 'chip-row');
  tags.appendChild(el('span', 'format-tag', a.platformFit === 'both' ? 'Multi-platform' : platformLabel(a.platformFit)));
  (a.formats || []).forEach((f) => tags.appendChild(el('span', 'format-tag', f)));

  const title = el('h3', 'angle-title', a.title);
  const hook = a.hook ? el('p', 'quote', `“${a.hook}”`) : null;
  const rationale = a.rationale ? el('p', 'mini-card-line', a.rationale) : null;

  const facts = el('ul', 'angle-facts');
  (a.facts || []).forEach((f) => {
    const li = el('li');
    li.textContent = f;
    facts.appendChild(li);
  });

  // generate-posts controls
  const controls = el('div', 'row angle-controls');
  const platformSel = el('select');
  platformSel.className = 'angle-platform';
  const defaultPlatform = PLATFORMS.some((p) => p.v === a.platformFit) ? a.platformFit : 'x';
  PLATFORMS.forEach((o) => {
    const opt = el('option', null, o.t);
    opt.value = o.v;
    platformSel.appendChild(opt);
  });
  platformSel.value = defaultPlatform;

  const subInput = el('input', 'angle-subreddit');
  subInput.type = 'text';
  subInput.placeholder = 'subreddit (no r/)';
  subInput.style.display = defaultPlatform === 'reddit' ? '' : 'none';
  platformSel.addEventListener('change', () => {
    subInput.style.display = platformSel.value === 'reddit' ? '' : 'none';
  });

  const genBtn = el('button', 'primary', '✨ Generate posts from this angle');
  genBtn.addEventListener('click', async () => {
    genBtn.disabled = true;
    genBtn.textContent = '⏳ Generating…';
    try {
      const data = await api('/api/generate', {
        method: 'POST',
        body: {
          angleId: a.id,
          platform: platformSel.value,
          subreddit: platformSel.value === 'reddit' ? subInput.value.trim() : undefined,
          count: 4,
        },
      });
      switchTab('create');
      renderVariants(data.posts);
      toast(`Generated ${data.posts.length} posts from "${a.title}".`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast(err.message, true);
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = '✨ Generate posts from this angle';
    }
  });

  controls.appendChild(platformSel);
  controls.appendChild(subInput);
  controls.appendChild(genBtn);

  const del = el('button', 'danger angle-del', '🗑');
  del.title = 'Delete angle';
  del.addEventListener('click', async () => {
    try {
      await api(`/api/angles/${a.id}`, { method: 'DELETE' });
      card.remove();
    } catch (err) {
      toast(err.message, true);
    }
  });

  card.appendChild(tags);
  card.appendChild(title);
  if (hook) card.appendChild(hook);
  if (rationale) card.appendChild(rationale);
  if (facts.children.length) card.appendChild(facts);
  card.appendChild(controls);
  card.appendChild(del);
  return card;
}

// ---------------------------------------------------------------- queue

async function loadQueue() {
  const wrap = $('#queue');
  wrap.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const data = await api('/api/posts');
    const active = data.posts.filter((p) => ['scheduled', 'posting'].includes(p.status));
    const badge = $('#queue-badge');
    badge.textContent = active.length;
    badge.classList.toggle('hidden', active.length === 0);

    if (!data.posts.length) {
      wrap.innerHTML = '<p class="empty">Nothing here yet. Generate some posts in the Create tab.</p>';
      return;
    }

    wrap.innerHTML = '';
    const order = { posting: 0, scheduled: 1, failed: 2, approved: 3, posted: 4, draft: 5, rejected: 6 };
    data.posts.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.id - a.id);
    data.posts.forEach((p) => {
      const card = variantCard(p, { allowSchedule: false });
      if (p.scheduled_at && p.status === 'scheduled') {
        const when = document.createElement('div');
        when.className = 'hint';
        when.textContent = `Scheduled: ${fmtDate(p.scheduled_at)}`;
        card.querySelector('.extra').appendChild(when);
      }
      if (p.posted_at && p.status === 'posted') {
        const when = document.createElement('div');
        when.className = 'hint';
        when.textContent = `Posted: ${fmtDate(p.posted_at)}`;
        card.querySelector('.extra').appendChild(when);
      }
      wrap.appendChild(card);
    });
  } catch (err) {
    wrap.innerHTML = `<p class="error-text">${err.message}</p>`;
  }
}

// ---------------------------------------------------------------- schedule

// only counts as "scheduled" once it actually has a time set
const SCHEDULED_STATUSES = ['scheduled', 'posting'];

let calMonth = new Date();
calMonth.setDate(1);
calMonth.setHours(0, 0, 0, 0);
let calDay = null; // local YYYY-MM-DD of the selected day, or null for "all"

function dayKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

$('#cal-prev').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  loadSchedule();
});

$('#cal-next').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  loadSchedule();
});

$('#cal-title').addEventListener('click', () => {
  calMonth = new Date();
  calMonth.setDate(1);
  calMonth.setHours(0, 0, 0, 0);
  calDay = null;
  loadSchedule();
});

async function loadSchedule() {
  const wrap = $('#schedule');
  wrap.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const data = await api('/api/posts/scheduled');
    const posts = data.posts.filter((p) => SCHEDULED_STATUSES.includes(p.status));

    const badge = $('#schedule-badge');
    badge.textContent = posts.length;
    badge.classList.toggle('hidden', posts.length === 0);

    renderCalendarGrid(posts);
    renderScheduleList(posts, wrap);
  } catch (err) {
    wrap.innerHTML = `<p class="error-text">${err.message}</p>`;
  }
}

function renderCalendarGrid(posts) {
  $('#cal-title').textContent = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const byDay = new Map();
  posts.forEach((p) => {
    const key = dayKey(new Date(p.scheduled_at));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(p);
  });

  const grid = $('#cal-grid');
  grid.innerHTML = '';

  // Monday-first header
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((label) => {
    const h = document.createElement('div');
    h.className = 'cal-head';
    h.textContent = label;
    grid.appendChild(h);
  });

  const todayKey = dayKey(new Date());
  const firstDow = (calMonth.getDay() + 6) % 7;
  const start = new Date(calMonth);
  start.setDate(1 - firstDow);

  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = dayKey(date);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    if (date.getMonth() !== calMonth.getMonth()) cell.classList.add('outside');
    if (key === todayKey) cell.classList.add('today');
    if (key === calDay) cell.classList.add('selected');

    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = date.getDate();
    cell.appendChild(num);

    const items = byDay.get(key) || [];
    if (items.length) {
      const count = document.createElement('span');
      count.className = 'cal-count';
      count.textContent = items.length;
      cell.appendChild(count);
      const first = document.createElement('span');
      first.className = 'cal-chip';
      first.textContent = new Date(items[0].scheduled_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      cell.appendChild(first);
    }

    cell.addEventListener('click', () => {
      calDay = calDay === key ? null : key;
      loadSchedule();
    });

    grid.appendChild(cell);
  }

  const hint = $('#cal-hint');
  const monthCount = [...byDay.keys()].filter((k) => k.startsWith(`${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, '0')}`)).length;
  hint.textContent = monthCount
    ? `${posts.length} scheduled ${posts.length === 1 ? 'post' : 'posts'} total · ${monthCount} ${monthCount === 1 ? 'day has' : 'days have'} posts this month.`
    : 'No scheduled posts this month. Approve a post in the Queue, then give it a date.';
}

function renderScheduleList(posts, wrap) {
  const filtered = calDay ? posts.filter((p) => dayKey(new Date(p.scheduled_at)) === calDay) : posts;

  if (!posts.length) {
    wrap.innerHTML = '<p class="empty">Nothing scheduled yet. Approve a post and pick a date in the Queue tab.</p>';
    return;
  }
  if (!filtered.length) {
    wrap.innerHTML = '<p class="empty">No scheduled posts on that day. Click the day again to show all.</p>';
    return;
  }

  wrap.innerHTML = '';
  filtered.forEach((p) => {
    const card = variantCard(p, { allowSchedule: false });
    const when = document.createElement('div');
    when.className = 'hint';
    when.textContent = `Scheduled: ${fmtDate(p.scheduled_at)}`;
    card.querySelector('.extra').appendChild(when);
    wrap.appendChild(card);
  });
}

// ---------------------------------------------------------------- settings

async function loadSettings() {
  try {
    const s = await api('/api/settings');
    const list = $('#settings-status');
    list.innerHTML = '';

    const row = (label, ok, okText = 'Configured', badText = 'Not configured') => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${label}</span><span class="${ok ? 'ok' : 'missing'}">${ok ? okText : badText}</span>`;
      list.appendChild(li);
    };

    // AI provider picker
    const select = $('#ai-provider');
    const detail = $('#ai-provider-detail');
    select.innerHTML = '';
    (s.ai?.available || []).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = p.name + (p.configured ? '' : ' (not configured)');
      if (p.key === s.ai?.provider) opt.selected = true;
      select.appendChild(opt);
    });
    const active = (s.ai?.available || []).find((p) => p.key === s.ai?.provider);
    if (active) {
      detail.textContent = `Active: ${active.name} · model: ${active.model}${active.base_url ? ` · base URL: ${active.base_url}` : ''}`;
    }
    (s.ai?.available || []).forEach((p) => {
      row(
        p.name,
        p.configured,
        p.key === s.ai?.provider ? `${p.model} · active` : `${p.model} · ready`,
        p.key === 'ollama' ? 'Check OLLAMA_BASE_URL' : 'Set key in .env'
      );
    });
    row('Reddit', s.reddit?.configured, `Saved (@${s.reddit?.username})`, 'Add credentials below');
    row('X — API', s.x?.api_configured, 'Bearer token set', 'No token (using browser fallback if connected)');
    row('X — browser session', s.x?.browser_session, 'Session saved', 'Not connected');

    // One connect button + status row per browser-session platform
    // (TikTok / YT Shorts / Instagram).
    const connectors = $('#browser-connectors');
    connectors.innerHTML = '';
    Object.entries(s.browsers || {}).forEach(([key, info]) => {
      row(`${info.label} — session`, info.browser_session, 'Session saved', 'Not connected (browser posters need this)');

      const btn = document.createElement('button');
      btn.textContent = info.browser_session ? `✅ ${info.label} connected` : `🔗 Connect ${info.label} (opens browser)`;
      btn.className = info.browser_session ? '' : 'primary';
      btn.disabled = info.browser_session;
      const out = el('span', 'hint');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        out.textContent = `Browser window opening — log in to ${info.label} there. This can take a few minutes.`;
        try {
          await api(`/api/settings/${key}/connect`, { method: 'POST' });
          out.textContent = `✅ ${info.label} session saved.`;
          loadSettings();
        } catch (err) {
          out.textContent = `❌ ${err.message}`;
          btn.disabled = false;
        }
      });
      connectors.appendChild(btn);
      connectors.appendChild(out);
    });
  } catch (err) {
    toast(err.message, true);
  }
}

$('#ai-provider-save').addEventListener('click', async () => {
  const out = $('#ai-provider-result');
  try {
    const provider = $('#ai-provider').value;
    await api('/api/settings/ai', { method: 'POST', body: { provider } });
    out.textContent = `✅ Switched to ${provider}.`;
    loadSettings();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#reddit-save').addEventListener('click', async () => {
  try {
    await api('/api/settings/reddit', {
      method: 'POST',
      body: {
        username: $('#reddit-username').value.trim(),
        password: $('#reddit-password').value,
        client_id: $('#reddit-client-id').value.trim(),
        client_secret: $('#reddit-client-secret').value,
      },
    });
    toast('Reddit credentials saved.');
    loadSettings();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#reddit-test').addEventListener('click', async () => {
  const out = $('#reddit-test-result');
  out.textContent = 'Testing…';
  try {
    await api('/api/preview-reddit', { method: 'POST' });
    out.textContent = '✅ Connected successfully.';
  } catch (err) {
    out.textContent = `❌ ${err.message}`;
  }
});

$('#x-connect').addEventListener('click', async () => {
  const out = $('#x-connect-result');
  const btn = $('#x-connect');
  btn.disabled = true;
  out.textContent = 'Browser window opening — log in to X there. This can take a few minutes.';
  try {
    await api('/api/settings/x/connect', { method: 'POST' });
    out.textContent = '✅ X session saved.';
    loadSettings();
  } catch (err) {
    out.textContent = `❌ ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// refresh queue + schedule badge periodically
setInterval(() => {
  if ($('#tab-queue').classList.contains('active')) loadQueue();
  if ($('#tab-schedule').classList.contains('active')) loadSchedule();
}, 30000);