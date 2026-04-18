// JobInsight Background Service Worker

// ─── Backend URL ──────────────────────────────────────────────────────────────
const BACKEND_URL = 'https://jobinsight-6nyq.onrender.com';

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_JOB') {
    analyzeJob(message.data)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ─── Backend proxy call ───────────────────────────────────────────────────────

async function analyzeJob({ jobDescription, userEmail }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000); // 30-second timeout

  let response;
  try {
    response = await fetch(`${BACKEND_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobDescription, userEmail }),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. The server may be waking up — please try again in a moment.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server returned an unexpected response (status ${response.status}). It may still be waking up — please try again.`);
  }

  if (!response.ok) {
    throw new Error(data.error || `Server error ${response.status}`);
  }

  return data;
}
