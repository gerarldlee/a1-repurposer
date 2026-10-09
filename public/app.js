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
  });
});

// ---------------------------------------------------------------- create

function platform() {
  return document.querySelector('input[name="platform"]:checked').value;
}

$$('input[name="platform"]').forEach((r) =>
  r.addEventListener('change', () => {
    $('#subreddit-row').classList.toggle('hidden', platform() !== 'reddit');
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
      if (post.platform === 'reddit') {
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
          renderImage();
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

  function renderImage() {
    imageArea.innerHTML = '';
    if (post.platform !== 'x') return; // image attach is X-only for now

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
          renderImage();
        } catch (err) {
          toast(err.message, true);
        }
      });
      wrap.appendChild(img);
      wrap.appendChild(removeBtn);
      imageArea.appendChild(wrap);
    } else {
      const attachBtn = document.createElement('button');
      attachBtn.textContent = post.format === 'screenshot' ? '📸 Attach screenshot (required for this format)' : '📸 Attach image';
      if (post.format === 'screenshot') attachBtn.classList.add('primary');
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
        renderImage();
        toast('Screenshot attached.');
      } catch (err) {
        toast(err.message, true);
      } finally {
        fileInput.value = '';
      }
    });

    imageArea.appendChild(fileInput);
  }

  renderContent();
  renderImage();
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