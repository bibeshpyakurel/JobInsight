// JobInsight Content Script — LinkedIn Job Analyzer
// Auto-triggers when a job page loads, injects floating overlay with analysis

(function () {
  'use strict';

  // ─── Constants (must be declared before any code runs) ──────────────────────

  const DESC_SELECTORS = [
    '.jobs-description-content__text',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '[class*="jobs-description-content"]',
    '.job-view-layout .jobs-description'
  ];

  // L1 in-memory cache: jobId → aiResult — instant, session-only
  const analysisCache = new Map();

  // L2 persistent cache helpers — AI results survive page reloads (7-day TTL)
  const JOB_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

  async function loadPersistedJob(jobId) {
    try {
      const key    = `ji_job:${jobId}`;
      const result = await chrome.storage.local.get(key);
      const entry  = result[key];
      if (entry && entry.ts && (Date.now() - entry.ts) < JOB_CACHE_TTL) return entry.aiResult;
    } catch (_) {}
    return null;
  }

  function persistJob(jobId, aiResult) {
    // Fire-and-forget — never block the UI on a storage write
    chrome.storage.local.set({ [`ji_job:${jobId}`]: { aiResult, ts: Date.now() } })
      .catch(() => {});
  }

  let currentJobId   = null;
  let overlayEl      = null;
  let contentWatcher = null;

  // ─── SPA Navigation Detection ──────────────────────────────────────────────

  let lastJobId    = getJobId();
  let navDebounce  = null;

  // Debounce the MutationObserver — LinkedIn fires hundreds of DOM mutations/sec.
  // Without this, getJobId() (URLSearchParams) runs on every mutation, blocking
  // the main thread and making everything feel slow.
  const navObserver = new MutationObserver(() => {
    clearTimeout(navDebounce);
    navDebounce = setTimeout(() => {
      const id = getJobId();
      if (id !== lastJobId) {
        lastJobId = id;
        onJobChange(id);
      }
    }, 80); // 80ms — fast enough to feel instant, cheap enough not to block
  });
  navObserver.observe(document.body, { childList: true, subtree: true });

  // Initial trigger — fires immediately if a job is already visible on page load
  onJobChange(getJobId());

  async function onJobChange(jobId) {
    contentWatcher?.disconnect();
    contentWatcher = null;

    if (!jobId || !isJobDetailPage()) {
      removeOverlay();
      return;
    }

    // ── L1: In-memory cache — instant, no I/O ────────────────────────────────
    if (analysisCache.has(jobId)) {
      currentJobId = jobId;
      const aiResult = analysisCache.get(jobId);
      showOverlay('results', aiResult);
      setupSummaryAccordion();
      setupHighlightToggle(aiResult);
      return;
    }

    // ── L2: Persistent storage cache — survives page reloads ─────────────────
    const persistedAI = await loadPersistedJob(jobId);
    // Guard: user may have navigated to a different job during the storage read
    if (jobId !== getJobId() || !isJobDetailPage()) return;

    if (persistedAI) {
      currentJobId = jobId;
      analysisCache.set(jobId, persistedAI);
      showOverlay('results', persistedAI);
      setupSummaryAccordion();
      setupHighlightToggle(persistedAI);
      return;
    }

    // ── L3: Network — first time seeing this job ──────────────────────────────
    const early = extractEarlyInfo();
    showOverlay('loading', early);

    if (getDescriptionElement()) {
      tryAnalyze(jobId, early);
    } else {
      watchForContent(jobId, early);
    }
  }

  function watchForContent(jobId, early) {
    // Poll every 150ms instead of a MutationObserver on the whole body.
    // Cheaper on CPU, still fast enough to feel instant (avg wait < 300ms).
    let attempts = 0;
    const MAX    = 53; // ~8 seconds total

    const poll = setInterval(() => {
      attempts++;
      if (getDescriptionElement()) {
        clearInterval(poll);
        contentWatcher = null;
        tryAnalyze(jobId, early);
      } else if (attempts >= MAX) {
        clearInterval(poll);
        contentWatcher = null;
      }
    }, 150);

    // Store so onJobChange can cancel a stale watcher on fast navigation
    contentWatcher = { disconnect: () => clearInterval(poll) };
  }

  function isJobDetailPage() {
    return /linkedin\.com\/jobs\/(view|search|collections)/.test(location.href);
  }

  // ─── Job Data Extraction ────────────────────────────────────────────────────

  function getDescriptionElement() {
    for (const sel of DESC_SELECTORS) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim().length > 100) return el;
    }
    return null;
  }

  // ─── Company Name Resolution (shared, multi-strategy) ──────────────────────

  const COMPANY_SELECTORS = [
    // Detail pane — current LinkedIn DOM (2024-2025)
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    // Older / alternate layouts
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    '.topcard__org-name-link',
    '[data-tracking-control-name="public_jobs_topcard-org-name"]',
    // Job card (selected item in list view)
    '.job-card-container--selected .job-card-container__company-name',
    '.jobs-search-results-list__list-item--active .job-card-container__company-name',
    // Generic fallbacks
    '[class*="company-name"] a',
    '[class*="company-name"]',
    '[class*="topcard__flavor"] a',
    '[class*="topcard__flavor"]'
  ];

  function resolveCompanyName(descriptionText) {
    // Strategy 1: DOM selectors
    for (const sel of COMPANY_SELECTORS) {
      const text = document.querySelector(sel)?.textContent?.trim();
      if (text && text.length > 0 && text.length < 120) return text;
    }

    // Strategy 2: page <title> — LinkedIn formats it as "Job Title at Company | LinkedIn"
    // or "Job Title - Company | LinkedIn"
    const titleText = document.title || '';
    const titleMatch = titleText.match(/(?:\bat\b\s+|[-–]\s+)([^|]+?)\s*(?:\||$)/i);
    if (titleMatch) {
      const candidate = titleMatch[1].trim();
      // Reject if it looks like a generic page title word
      if (candidate.length > 1 && !/^linkedin$/i.test(candidate)) return candidate;
    }

    // Strategy 3: og:title meta tag (same format as page title)
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
    const ogMatch = ogTitle.match(/(?:\bat\b\s+|[-–]\s+)([^|]+?)\s*(?:\||$)/i);
    if (ogMatch) {
      const candidate = ogMatch[1].trim();
      if (candidate.length > 1 && !/^linkedin$/i.test(candidate)) return candidate;
    }

    // Strategy 4: scan job description for "About [Company]" section header
    if (descriptionText) {
      const aboutMatch = descriptionText.match(/\bAbout\s+([A-Z][A-Za-z0-9& ,.'()-]{1,60}?)[\r\n:]/);
      if (aboutMatch) return aboutMatch[1].trim();
    }

    return '';
  }

  function extractJobData() {
    const descEl = getDescriptionElement();

    if (!descEl) return null;

    const description = descEl.textContent.trim();
    if (description.length < 100) return null;

    const company = resolveCompanyName(description) || 'Unknown Company';

    // Job title (for display in overlay header)
    const titleSelectors = [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.jobs-unified-top-card__job-title h1',
      '.topcard__title',
      'h1[class*="job-title"]',
      'h1'
    ];

    let title = '';
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 0 && text.length < 150) {
        title = text;
        break;
      }
    }

    return { description, company, title };
  }

  function getJobId() {
    // /jobs/view/123456789/
    const pathMatch = location.href.match(/\/jobs\/view\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    // /jobs/search/?currentJobId=123456789  (search & collections pages)
    const param = new URLSearchParams(location.search).get('currentJobId');
    if (param) return param;
    return null;
  }

  // Reads job title + company from the already-visible detail card header —
  // available before the full description loads, so we can show the overlay
  // and start the H1B lookup without waiting.
  function extractEarlyInfo() {
    const titleSelectors = [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.jobs-unified-top-card__job-title h1',
      '.topcard__title',
      'h1[class*="job-title"]',
      // Job list card (selected item) — even earlier
      '.job-card-container--selected .job-card-list__title',
      '.jobs-search-results-list__list-item--active .job-card-list__title'
    ];

    let title = '';
    for (const s of titleSelectors) { const t = document.querySelector(s)?.textContent?.trim(); if (t) { title = t; break; } }

    // Use shared resolver — no description text available yet at this early stage
    const company = resolveCompanyName('');

    return { title, company };
  }

  // ─── Analysis Flow ──────────────────────────────────────────────────────────

  async function tryAnalyze(jobId, early = {}) {
    if (jobId !== getJobId()) return; // user navigated away before description loaded
    if (jobId === currentJobId) return; // already running
    currentJobId = jobId;

    const jobData = extractJobData();
    if (!jobData) return;

    const { openaiApiKey } = await chrome.storage.local.get('openaiApiKey');
    if (!openaiApiKey) { showOverlay('no-api-key'); return; }

    const company = jobData.company || early.company || '';
    const title   = jobData.title   || early.title   || '';

    // Cap at 4000 chars — covers all relevant content in any job posting.
    // Sending 15,000-char descriptions triples token count and API latency for no gain.
    const trimmedDescription = jobData.description.slice(0, 4000);

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_JOB', data: { jobDescription: trimmedDescription, apiKey: openaiApiKey } },
      (result) => {
        if (chrome.runtime.lastError) { showOverlay('error', { message: chrome.runtime.lastError.message }); return; }
        if (result?.error)            { showOverlay('error', { message: result.error }); return; }

        const aiResult = { ...result, company, title };

        // L1: in-memory cache
        analysisCache.set(jobId, aiResult);
        // L2: persist so next page load skips the OpenAI call entirely
        persistJob(jobId, aiResult);

        showOverlay('results', aiResult);
        setupSummaryAccordion();
        setupHighlightToggle(result);
      }
    );
  }

  // ─── Overlay Management ─────────────────────────────────────────────────────

  function removeOverlay() {
    clearHighlights();
    overlayEl?.remove();
    overlayEl = null;
    currentJobId = null;
  }

  function showOverlay(state, data = {}) {
    if (!overlayEl) createOverlay(data);

    const body = overlayEl.querySelector('.ji-body');
    const statusEl = overlayEl.querySelector('.ji-status');
    const positionEl = overlayEl.querySelector('.ji-position-title');

    // Update position banner whenever we have a title
    if (data.title && positionEl) {
      positionEl.textContent = data.title;
    }

    switch (state) {
      case 'loading':
        statusEl.textContent = 'Analyzing…';
        statusEl.className = 'ji-status ji-status--loading';
        body.innerHTML = renderLoading();
        break;

      case 'no-api-key':
        statusEl.textContent = 'Setup needed';
        statusEl.className = 'ji-status ji-status--warn';
        body.innerHTML = `
          <div class="ji-message">
            Add your Claude API key via the<br>
            <strong>JobInsight extension icon</strong> in the toolbar.
          </div>`;
        break;

      case 'error':
        statusEl.textContent = 'Error';
        statusEl.className = 'ji-status ji-status--error';
        body.innerHTML = `<div class="ji-message ji-message--error">⚠ ${escHtml(data.message || 'Unknown error')}</div>`;
        break;

      case 'results':
        statusEl.textContent = 'Done';
        statusEl.className = 'ji-status ji-status--done';
        body.innerHTML = renderResults(data);
        // Note: setupH1BAccordion / setupSummaryAccordion / setupHighlightToggle
        // are called by tryAnalyze so it can pass the live h1bData closure.
        break;
    }
  }

  function createOverlay(data = {}) {
    overlayEl = document.createElement('div');
    overlayEl.id = 'jobinsight-overlay';
    overlayEl.innerHTML = `
      <div class="ji-inner">
        <div class="ji-header" id="ji-drag-handle">
          <span class="ji-logo">⚡ JobInsight</span>
          <div class="ji-header-right">
            <span class="ji-status"></span>
          </div>
        </div>
        <div class="ji-position-banner">
          <span class="ji-position-title">${escHtml(data.title || 'Analyzing position…')}</span>
        </div>
        <div class="ji-body"></div>
      </div>
    `;

    attachInteractions(overlayEl);
    document.body.appendChild(overlayEl);
  }

  // ─── Render Helpers ─────────────────────────────────────────────────────────

  function renderLoading() {
    const labels = [
      'Experience', 'Education', 'Sponsorship',
      'US Citizenship', 'Summary', 'Keywords'
    ];
    return `<div class="ji-loading-list">
      ${labels.map(l => `
        <div class="ji-loading-row">
          <span class="ji-loading-label">${l}</span>
          <span class="ji-loading-bar"><span class="ji-pulse"></span></span>
        </div>`).join('')}
    </div>`;
  }

  function renderResults(d) {
    return `
      <div class="ji-sections">

        <div class="ji-section">
          <div class="ji-grid">
            <div class="ji-field">
              <div class="ji-label">Experience</div>
              <div class="ji-value">${escHtml(d.yearsOfExperience || 'Not specified')}</div>
            </div>
            <div class="ji-field">
              <div class="ji-label">Education</div>
              <div class="ji-value ji-value--small">${escHtml(d.education || 'Degree Not Specified')}</div>
            </div>
            <div class="ji-field">
              <div class="ji-label">Sponsorship</div>
              <div class="ji-value">${sponsorshipBadge(d.sponsorship)}</div>
            </div>
            <div class="ji-field ji-field--full">
              <div class="ji-label">US Citizenship Requirement</div>
              <div class="ji-value">${citizenshipBadge(d.usCitizenshipRequired)}</div>
            </div>
          </div>
        </div>

        <div class="ji-section">
          <div class="ji-accordion-trigger ji-summary-trigger" id="ji-summary-trigger">
            <span class="ji-label" style="margin:0">Summary</span>
            <span class="ji-chevron">▼</span>
          </div>
          <div class="ji-accordion-body" id="ji-summary-body">
            <div class="ji-summary">${escHtml(d.summary || 'N/A')}</div>
          </div>
        </div>

        <div class="ji-section">
          <div class="ji-label">Keywords</div>
          <div class="ji-keywords">
            ${(d.keywords || []).map(k => `<span class="ji-keyword">${escHtml(k)}</span>`).join('')}
          </div>
        </div>

      </div>`;
  }

  function sponsorshipBadge(val) {
    const v = (val || '').toLowerCase();
    if (v === 'sponsors') return `<span class="ji-badge ji-badge--green">Sponsors</span>`;
    if (v === 'does not sponsor') return `<span class="ji-badge ji-badge--red">Does Not Sponsor</span>`;
    return `<span class="ji-badge ji-badge--gray">Not Mentioned</span>`;
  }

  function citizenshipBadge(val) {
    const v = (val || '').toLowerCase();
    if (v === 'required') return `<span class="ji-badge ji-badge--red">Required</span>`;
    return `<span class="ji-badge ji-badge--gray">Not Mentioned</span>`;
  }

  function setupSummaryAccordion() {
    const trigger = overlayEl?.querySelector('#ji-summary-trigger');
    const bodyEl = overlayEl?.querySelector('#ji-summary-body');
    if (!trigger || !bodyEl) return;

    // Expanded by default
    bodyEl.style.display = 'block';
    trigger.querySelector('.ji-chevron').textContent = '▲';

    trigger.addEventListener('click', () => {
      const open = bodyEl.style.display === 'block';
      bodyEl.style.display = open ? 'none' : 'block';
      trigger.querySelector('.ji-chevron').textContent = open ? '▼' : '▲';
    });
  }

  // ─── Highlight in Job Description (auto, no button) ─────────────────────────

  function setupHighlightToggle(data) {
    // Small delay so LinkedIn finishes any DOM settling after navigation
    setTimeout(() => applyHighlights(data), 400);
  }

  function buildTerms(data) {
    const terms = new Set();

    // Keywords — highest priority
    (data.keywords || []).forEach(k => { if (k?.trim().length >= 2) terms.add(k.trim()); });

    // Education — pull meaningful words from the category label
    if (data.education) {
      const eduMatches = data.education.match(
        /\b(Bachelor|Master|MBA|PhD|Doctorate|GED|High School|degree|equivalent experience)\b/gi
      );
      (eduMatches || []).forEach(w => terms.add(w));
    }

    // Experience — add phrase only (not bare digits, which are too noisy)
    if (data.yearsOfExperience && data.yearsOfExperience !== 'Not specified') {
      terms.add('years of experience');
      terms.add('years experience');
    }

    // Sponsorship
    if (data.sponsorship === 'Sponsors') {
      terms.add('H1B');
      terms.add('H-1B');
      terms.add('visa sponsor');
      terms.add('visa sponsorship');
    }

    // US citizenship / clearance
    if (data.usCitizenshipRequired === 'Required') {
      terms.add('US citizen');
      terms.add('United States citizen');
      terms.add('citizenship required');
      terms.add('security clearance');
      terms.add('clearance');
    }

    // Minimum 2 chars; longest first so longer phrases take priority over sub-phrases
    return [...terms].filter(t => t && t.trim().length >= 2)
      .sort((a, b) => b.length - a.length);
  }

  function applyHighlights(data) {
    const descEl = getDescriptionElement();
    if (!descEl) return;

    const terms = buildTerms(data);
    if (!terms.length) return;

    // Wrap each term in lookahead/lookbehind word boundaries.
    // This prevents "TS" matching inside "tests", "AWS" inside "passwords", etc.
    // Lookahead/lookbehind is used instead of \b so terms containing special
    // characters (C++, .NET, H-1B) are also bounded correctly.
    const boundedPatterns = terms.map(t => {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return `(?<![a-zA-Z0-9_])(?:${esc})(?![a-zA-Z0-9_])`;
    });
    const regex = new RegExp(`(${boundedPatterns.join('|')})`, 'gi');

    // Walk text nodes only — never touch element nodes directly
    const walker = document.createTreeWalker(
      descEl,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // Skip already-highlighted spans and script/style
          const tag = node.parentElement?.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.classList?.contains('ji-hl')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const toReplace = [];
    let node;
    while ((node = walker.nextNode())) {
      if (regex.test(node.textContent)) toReplace.push(node);
      regex.lastIndex = 0;
    }

    toReplace.forEach(textNode => {
      const text = textNode.textContent;
      const localRe = new RegExp(boundedPatterns.join('|'), 'gi');
      const fragment = document.createDocumentFragment();
      let last = 0;
      let m;

      while ((m = localRe.exec(text)) !== null) {
        if (m.index > last) {
          fragment.appendChild(document.createTextNode(text.slice(last, m.index)));
        }
        const span = document.createElement('span');
        span.className = 'ji-hl';
        span.textContent = m[0];
        fragment.appendChild(span);
        last = m.index + m[0].length;
      }

      if (last < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(last)));
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    });
  }

  function clearHighlights() {
    // Replace each .ji-hl span with its plain text content
    document.querySelectorAll('.ji-hl').forEach(span => {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    // Normalise adjacent text nodes left behind by replaceWith
    getDescriptionElement()?.normalize();
  }

  // ─── Drag + Resize (unified, edge-detection based) ──────────────────────────
  // Detects which edge the mouse is near using getBoundingClientRect() so it
  // works correctly regardless of the overlay's dynamic height — no separate
  // handle elements needed.

  function attachInteractions(el) {
    const EDGE   = 8;   // px from border that counts as "on the edge"
    const MIN_W  = 260, MAX_W = 640, MIN_H = 140;
    let active   = null; // { mode:'drag'|'resize', dir, sx, sy, sl, st, sw, sh }

    // ── Cursor tracking on hover ──────────────────────────────────────────────
    el.addEventListener('mousemove', (e) => {
      if (active) return;
      const dir = getEdgeDir(e, el, EDGE);
      if (dir) {
        el.style.cursor = edgeCursor(dir);
      } else if (e.target.closest('#ji-drag-handle')) {
        el.style.cursor = 'grab';
      } else {
        el.style.cursor = 'default';
      }
    });

    el.addEventListener('mouseleave', () => {
      if (!active) el.style.cursor = '';
    });

    // ── Start interaction ─────────────────────────────────────────────────────
    el.addEventListener('mousedown', (e) => {
      const rect = el.getBoundingClientRect();
      const dir  = getEdgeDir(e, el, EDGE);

      if (dir) {
        // Resize from any edge or corner
        active = { mode: 'resize', dir,
          sx: e.clientX, sy: e.clientY,
          sl: rect.left,  st: rect.top,
          sw: rect.width, sh: rect.height };
        el.style.cursor = edgeCursor(dir);
        e.preventDefault();
        e.stopPropagation();
      } else if (e.target.closest('#ji-drag-handle')) {
        // Drag by header
        active = { mode: 'drag',
          sx: e.clientX, sy: e.clientY,
          sl: rect.left,  st: rect.top };
        el.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    // ── Move ──────────────────────────────────────────────────────────────────
    document.addEventListener('mousemove', (e) => {
      if (!active) return;
      const dx = e.clientX - active.sx;
      const dy = e.clientY - active.sy;

      if (active.mode === 'drag') {
        el.style.left   = `${active.sl + dx}px`;
        el.style.top    = `${active.st + dy}px`;
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
        return;
      }

      // Resize
      const d = active.dir;
      let L = active.sl, T = active.st, W = active.sw, H = active.sh;

      if (d.includes('e')) W = clamp(active.sw + dx, MIN_W, MAX_W);
      if (d.includes('w')) { W = clamp(active.sw - dx, MIN_W, MAX_W); L = active.sl + (active.sw - W); }
      if (d.includes('s')) H = Math.max(active.sh + dy, MIN_H);
      if (d.includes('n')) { H = Math.max(active.sh - dy, MIN_H); T = active.st + (active.sh - H); }

      el.style.left   = `${L}px`;
      el.style.top    = `${T}px`;
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
      el.style.width  = `${W}px`;

      const inner = el.querySelector('.ji-inner');
      // Set the inner container to the dragged height; flex handles body sizing
      if (inner) {
        inner.style.height    = `${H}px`;
        inner.style.maxHeight = `${H}px`;
      }
    });

    // ── End ───────────────────────────────────────────────────────────────────
    document.addEventListener('mouseup', () => {
      active = null;
      el.style.cursor = '';
    });
  }

  function getEdgeDir(e, el, edge) {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const T = y <= edge,      B = y >= r.height - edge;
    const L = x <= edge,      R = x >= r.width  - edge;
    if (T && L) return 'nw';  if (T && R) return 'ne';
    if (B && L) return 'sw';  if (B && R) return 'se';
    if (T) return 'n';  if (B) return 's';
    if (L) return 'w';  if (R) return 'e';
    return null;
  }

  function edgeCursor(dir) {
    return { n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize',
             ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' }[dir];
  }

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  // ─── Utility ────────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
