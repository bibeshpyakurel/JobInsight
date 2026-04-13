// JobInsight Background Service Worker

// ─── Install ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  // Extension installed — nothing to configure here.
  // The OpenAI API key is stored in chrome.storage.local
  // and set by the user or loaded from a secure source.
});

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_JOB') {
    analyzeJob(message.data)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ─── OpenAI analysis ──────────────────────────────────────────────────────────

async function analyzeJob({ jobDescription, apiKey }) {
  const prompt = `Analyze the following LinkedIn job description and return ONLY a valid JSON object — no markdown fences, no explanation.

Return exactly this structure:
{
  "yearsOfExperience": "e.g. '3-5 years', '5+ years', or 'Not specified'",
  "education": "one of the exact labels listed below",
  "sponsorship": "Sponsors | Does Not Sponsor | Not Mentioned",
  "usCitizenshipRequired": "Required | Not Mentioned",
  "summary": "2-3 sentence overview of the role, team, and company",
  "keywords": ["8 to 12 job-specific technical or domain keywords"]
}

Rules:
- sponsorship: "Sponsors" if visa/work sponsorship is explicitly offered or clearly implied; "Does Not Sponsor" if explicitly stated they do not sponsor; "Not Mentioned" if the description is silent on sponsorship.
- usCitizenshipRequired: "Required" if any security clearance is required OR if US citizenship is explicitly required; "Not Mentioned" otherwise.
- education: return EXACTLY one of these labels — nothing else:
    "Bachelor's Degree Required"
    "Bachelor's Degree Preferred"
    "Master's Degree Required"
    "Master's Degree Preferred"
    "PhD Required"
    "PhD Preferred"
    "Equivalent Experience Accepted"
    "High School / GED Required"
    "Degree Not Specified"
- Keywords: specific technical terms (e.g. "Kubernetes", "HIPAA compliance", "React 18") not generic skills.

Job Description:
${jobDescription}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse response from OpenAI.');
  return JSON.parse(jsonMatch[0]);
}
