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
  const response = await fetch(`${BACKEND_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobDescription, userEmail })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Server error ${response.status}`);
  }

  return data;
}
