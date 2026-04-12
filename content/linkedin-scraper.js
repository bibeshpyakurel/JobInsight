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

  // Cache: jobId → { aiResult, h1bData }
  const analysisCache = new Map();

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

  function onJobChange(jobId) {
    contentWatcher?.disconnect();
    contentWatcher = null;

    if (!jobId || !isJobDetailPage()) {
      removeOverlay();
      return;
    }

    // ── Cache hit: show results instantly, no API call needed ─────────────────
    if (analysisCache.has(jobId)) {
      const { aiResult, h1bData } = analysisCache.get(jobId);
      currentJobId = jobId;
      showOverlay('results', aiResult);
      setupH1BAccordion(() => h1bData);
      setupSummaryAccordion();
      setupHighlightToggle(aiResult);
      updateH1BBadge(h1bData);
      return;
    }

    // ── New job: show loading overlay immediately using whatever we know now ──
    // extractEarlyInfo() reads the job card / detail header which loads before
    // the full description, giving the user instant visual feedback.
    const early = extractEarlyInfo();
    showOverlay('loading', early);

    // Shared state object — both H1B and AI callbacks write to the same reference
    // so whichever finishes last always has the full picture.
    const jobState = { h1bData: null }; // null=loading, false=none, object=found

    if (early.company) {
      chrome.runtime.sendMessage({ type: 'LOOKUP_H1B', company: early.company }, (res) => {
        jobState.h1bData = (res && !res.error && Object.keys(res).length > 0) ? res : false;
        updateH1BBadge(jobState.h1bData);
        // If AI already finished and stored the cache entry, backfill it
        if (analysisCache.has(jobId)) analysisCache.get(jobId).h1bData = jobState.h1bData;
      });
    }

    if (getDescriptionElement()) {
      tryAnalyze(jobId, jobState, early);
    } else {
      watchForContent(jobId, jobState, early);
    }
  }

  function watchForContent(jobId, jobState, early) {
    // Poll every 150ms instead of a MutationObserver on the whole body.
    // Cheaper on CPU, still fast enough to feel instant (avg wait < 300ms).
    let attempts = 0;
    const MAX    = 53; // ~8 seconds total

    const poll = setInterval(() => {
      attempts++;
      if (getDescriptionElement()) {
        clearInterval(poll);
        contentWatcher = null;
        tryAnalyze(jobId, jobState, early);
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

  function extractJobData() {
    const descEl = getDescriptionElement();

    if (!descEl) return null;

    const description = descEl.textContent.trim();
    if (description.length < 100) return null;

    // Company name
    const companySelectors = [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a',
      '.topcard__org-name-link',
      '[data-tracking-control-name="public_jobs_topcard-org-name"]',
      '[class*="company-name"] a',
      '[class*="company-name"]'
    ];

    let company = 'Unknown Company';
    for (const sel of companySelectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 0) {
        company = text;
        break;
      }
    }

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
    const companySelectors = [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a',
      '.topcard__org-name-link',
      '[class*="company-name"] a',
      '[class*="company-name"]',
      // Job list card
      '.job-card-container--selected .job-card-container__company-name',
      '.jobs-search-results-list__list-item--active .job-card-container__company-name'
    ];

    let title = '', company = '';
    for (const s of titleSelectors)   { const t = document.querySelector(s)?.textContent?.trim(); if (t) { title   = t; break; } }
    for (const s of companySelectors) { const t = document.querySelector(s)?.textContent?.trim(); if (t) { company = t; break; } }
    return { title, company };
  }

  // ─── Analysis Flow ──────────────────────────────────────────────────────────

  async function tryAnalyze(jobId, jobState, early = {}) {
    if (jobId !== getJobId()) return; // user navigated away before description loaded
    if (jobId === currentJobId) return; // already running
    currentJobId = jobId;

    const jobData = extractJobData();
    if (!jobData) return;

    const { openaiApiKey } = await chrome.storage.local.get('openaiApiKey');
    if (!openaiApiKey) { showOverlay('no-api-key'); return; }

    const company = jobData.company || early.company || '';
    const title   = jobData.title   || early.title   || '';

    // If H1B lookup couldn't start early (no company name from card), start it now
    if (jobState.h1bData === null && company && !early.company) {
      chrome.runtime.sendMessage({ type: 'LOOKUP_H1B', company }, (res) => {
        jobState.h1bData = (res && !res.error && Object.keys(res).length > 0) ? res : false;
        updateH1BBadge(jobState.h1bData);
        if (analysisCache.has(jobId)) analysisCache.get(jobId).h1bData = jobState.h1bData;
      });
    }

    // Cap at 4000 chars — covers all relevant content in any job posting.
    // Sending 15,000-char descriptions triples token count and API latency for no gain.
    const trimmedDescription = jobData.description.slice(0, 4000);

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_JOB', data: { jobDescription: trimmedDescription, apiKey: openaiApiKey } },
      (result) => {
        if (chrome.runtime.lastError) { showOverlay('error', { message: chrome.runtime.lastError.message }); return; }
        if (result?.error)            { showOverlay('error', { message: result.error }); return; }

        const aiResult = { ...result, company, title };

        // Save to cache — h1bData may still be loading; H1B callback will backfill it
        analysisCache.set(jobId, { aiResult, h1bData: jobState.h1bData });

        showOverlay('results', aiResult);
        // Getter always reads the live cache entry so it works whether H1B finishes before or after AI
        setupH1BAccordion(() => analysisCache.get(jobId)?.h1bData);
        setupSummaryAccordion();
        setupHighlightToggle(result);
        updateH1BBadge(jobState.h1bData);
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
            <button class="ji-btn-minimize" title="Minimize">−</button>
          </div>
        </div>
        <div class="ji-position-banner">
          <span class="ji-position-title">${escHtml(data.title || 'Analyzing position…')}</span>
        </div>
        <div class="ji-body"></div>
      </div>
    `;

    // Minimize toggle
    let minimized = false;
    const body = overlayEl.querySelector('.ji-body');
    overlayEl.querySelector('.ji-btn-minimize').addEventListener('click', () => {
      minimized = !minimized;
      body.style.display = minimized ? 'none' : 'block';
      overlayEl.querySelector('.ji-btn-minimize').textContent = minimized ? '+' : '−';
    });

    attachInteractions(overlayEl);
    document.body.appendChild(overlayEl);
  }

  // ─── Render Helpers ─────────────────────────────────────────────────────────

  function renderLoading() {
    const labels = [
      'Experience', 'Education', 'E-Verify',
      'H1B Sponsorship', 'Security Clearance',
      'H1B History', 'Summary', 'Keywords'
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
    const clearanceLabel = d.securityClearance === 'Yes' && d.securityClearanceDetail
      ? `Required: ${d.securityClearanceDetail}`
      : (d.securityClearance === 'Yes' ? 'Required' : 'Not Required');

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
              <div class="ji-label">E-Verify</div>
              <div class="ji-value">${binaryBadge(d.eVerify, 'Confirmed', 'Not Confirmed')}</div>
            </div>
            <div class="ji-field">
              <div class="ji-label">H1B Sponsorship</div>
              <div class="ji-value">${binaryBadge(d.h1bSponsorship, 'Sponsored', 'Not Sponsored')}</div>
            </div>
            <div class="ji-field ji-field--full">
              <div class="ji-label">Security Clearance</div>
              <div class="ji-value">${binaryBadge(d.securityClearance, clearanceLabel, 'Not Required')}</div>
            </div>
          </div>
        </div>

        <div class="ji-section">
          <div class="ji-h1b-header">
            <div>
              <div class="ji-label">H1B History</div>
              <div class="ji-h1b-company">${escHtml(d.company)}</div>
            </div>
            <div id="ji-h1b-badge">
              <span class="ji-h1b-checking">Checking…</span>
            </div>
          </div>
          <div class="ji-accordion-trigger" id="ji-h1b-trigger">
            <span>View year-by-year breakdown</span>
            <span class="ji-chevron">▼</span>
          </div>
          <div class="ji-accordion-body" id="ji-h1b-body"></div>
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

  // Always green or red — no neutral state
  function binaryBadge(val, greenLabel, redLabel) {
    const isYes = (val || '').toLowerCase() === 'yes';
    const cls = isYes ? 'ji-badge ji-badge--green' : 'ji-badge ji-badge--red';
    return `<span class="${cls}">${escHtml(isYes ? greenLabel : redLabel)}</span>`;
  }

  // getH1B is a function () => h1bData so it always reads the latest value
  function setupH1BAccordion(getH1B) {
    const trigger = overlayEl?.querySelector('#ji-h1b-trigger');
    const bodyEl  = overlayEl?.querySelector('#ji-h1b-body');
    if (!trigger || !bodyEl) return;

    let open = false;

    trigger.addEventListener('click', () => {
      open = !open;
      bodyEl.style.display = open ? 'block' : 'none';
      trigger.querySelector('.ji-chevron').textContent = open ? '▲' : '▼';

      if (!open) return;

      const result = getH1B();

      if (result === null) {
        // Still loading — show spinner; badge update will re-render when ready
        bodyEl.innerHTML = '<div class="ji-h1b-msg">Loading H1B data…</div>';
        return;
      }

      renderH1BTable(bodyEl, result);
    });
  }

  function renderH1BTable(bodyEl, result) {
    if (!result || Object.keys(result).length === 0) {
      bodyEl.innerHTML = '<div class="ji-h1b-msg">No H1B filing data found for this employer.</div>';
      return;
    }
    const total = Object.values(result).reduce((a, b) => a + b, 0);
    bodyEl.innerHTML = `
      <div class="ji-h1b-total">Total filings: <strong>${total.toLocaleString()}</strong></div>
      <div class="ji-h1b-table">
        <div class="ji-h1b-row ji-h1b-head"><span>Year</span><span>Filings</span></div>
        ${Object.entries(result).map(([yr, cnt]) => `
          <div class="ji-h1b-row"><span>${yr}</span><span>${cnt.toLocaleString()}</span></div>
        `).join('')}
      </div>`;
  }

  function updateH1BBadge(h1bData) {
    const badgeEl = overlayEl?.querySelector('#ji-h1b-badge');
    if (!badgeEl) return; // overlay not rendered yet — will be applied after render

    if (h1bData === null) {
      // Still loading
      badgeEl.innerHTML = '<span class="ji-h1b-checking">Checking…</span>';
      return;
    }

    const hasHistory = h1bData && Object.keys(h1bData).length > 0;
    const total = hasHistory ? Object.values(h1bData).reduce((a, b) => a + b, 0) : 0;

    badgeEl.innerHTML = hasHistory
      ? `<span class="ji-badge ji-badge--green">✓ ${total.toLocaleString()} filings</span>`
      : `<span class="ji-badge ji-badge--red">✗ No history</span>`;

    // If the accordion body is open and was showing a loading spinner, fill it now
    const bodyEl = overlayEl?.querySelector('#ji-h1b-body');
    if (bodyEl?.style.display === 'block') {
      renderH1BTable(bodyEl, h1bData);
    }
  }

  function setupSummaryAccordion() {
    const trigger = overlayEl?.querySelector('#ji-summary-trigger');
    const bodyEl = overlayEl?.querySelector('#ji-summary-body');
    if (!trigger || !bodyEl) return;

    // Collapsed by default — user expands when needed
    bodyEl.style.display = 'none';

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
    (data.keywords || []).forEach(k => { if (k?.length >= 2) terms.add(k); });

    // Education — pull meaningful words from the category label
    if (data.education) {
      const eduMatches = data.education.match(
        /\b(Bachelor|Master|MBA|PhD|Doctorate|GED|High School|degree|equivalent experience)\b/gi
      );
      (eduMatches || []).forEach(w => terms.add(w));
    }

    // Experience — extract the numeric range or phrase
    if (data.yearsOfExperience && data.yearsOfExperience !== 'Not specified') {
      const nums = data.yearsOfExperience.match(/\d+\+?/g);
      (nums || []).forEach(n => terms.add(n));
      // Also add "years of experience" variants
      terms.add('years of experience');
      terms.add('years experience');
    }

    // E-Verify
    if (data.eVerify === 'Yes') {
      terms.add('E-Verify');
      terms.add('E-verify');
    }

    // H1B
    if (data.h1bSponsorship === 'Yes') {
      terms.add('H1B');
      terms.add('H-1B');
      terms.add('visa sponsor');
      terms.add('sponsorship');
    }

    // Security clearance
    if (data.securityClearance === 'Yes') {
      terms.add('clearance');
      terms.add('security clearance');
      if (data.securityClearanceDetail) terms.add(data.securityClearanceDetail);
    }

    // Filter: min 2 chars, avoid pure numbers shorter than 2 digits
    return [...terms].filter(t => t && t.trim().length >= 2)
      .sort((a, b) => b.length - a.length); // longest first avoids partial overlaps
  }

  function applyHighlights(data) {
    const descEl = getDescriptionElement();
    if (!descEl) return;

    const terms = buildTerms(data);
    if (!terms.length) return;

    const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');

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
      const localRe = new RegExp(escaped.join('|'), 'gi');
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
      if (e.target.closest('.ji-btn-minimize')) return;

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

      const inner  = el.querySelector('.ji-inner');
      const header = el.querySelector('.ji-header');
      const banner = el.querySelector('.ji-position-banner');
      const body   = el.querySelector('.ji-body');
      if (inner) inner.style.height = `${H}px`;
      if (body)  body.style.maxHeight =
        `${H - (header?.offsetHeight || 0) - (banner?.offsetHeight || 0)}px`;
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
