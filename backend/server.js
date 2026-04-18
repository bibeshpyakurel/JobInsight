const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Only allow requests from your specific Chrome extension
const ALLOWED_ORIGIN = process.env.EXTENSION_ID
  ? `chrome-extension://${process.env.EXTENSION_ID}`
  : null;

app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed'));
    }
  }
}));

app.use(express.json({ limit: '16kb' }));

// Rate limiting — simple in-memory per-email (use Redis in production)
const rateMap = new Map();
const RATE_LIMIT = 60;        // requests per window
const RATE_WINDOW = 60 * 1000; // 1 minute
const RATE_MAP_MAX = 10_000;   // cap entries to prevent unbounded growth

function checkRate(email) {
  const now = Date.now();
  const entry = rateMap.get(email);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    // Evict all expired entries before adding a new one when at capacity
    if (!entry && rateMap.size >= RATE_MAP_MAX) {
      for (const [key, val] of rateMap) {
        if (now - val.windowStart > RATE_WINDOW) rateMap.delete(key);
      }
    }
    rateMap.set(email, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

const ALLOWED_SPONSORSHIP = new Set(['Sponsors', 'Does Not Sponsor', 'Not Mentioned']);
const ALLOWED_CITIZENSHIP = new Set(['Required', 'Not Mentioned']);
const ALLOWED_EDUCATION = new Set([
  "Bachelor's Degree Required",
  "Bachelor's Degree Preferred",
  "Master's Degree Required",
  "Master's Degree Preferred",
  'PhD Required',
  'PhD Preferred',
  'Equivalent Experience Accepted',
  'High School / GED Required',
  'Degree Not Specified'
]);

function cleanSentence(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAnalysis(parsed) {
  const rawSponsorship = ALLOWED_SPONSORSHIP.has(parsed?.sponsorship)
    ? parsed.sponsorship
    : 'Not Mentioned';

  const rawUsCitizenshipRequired = ALLOWED_CITIZENSHIP.has(parsed?.usCitizenshipRequired)
    ? parsed.usCitizenshipRequired
    : 'Not Mentioned';

  const education = ALLOWED_EDUCATION.has(parsed?.education)
    ? parsed.education
    : 'Degree Not Specified';

  const rawSponsorshipEvidence = rawSponsorship === 'Not Mentioned'
    ? ''
    : cleanSentence(parsed?.sponsorshipEvidence);

  const rawUsCitizenshipEvidence = rawUsCitizenshipRequired === 'Required'
    ? cleanSentence(parsed?.usCitizenshipEvidence)
    : '';

  const sponsorship = rawSponsorshipEvidence ? rawSponsorship : 'Not Mentioned';
  const sponsorshipEvidence = rawSponsorshipEvidence ? rawSponsorshipEvidence : '';

  const usCitizenshipRequired = rawUsCitizenshipEvidence ? rawUsCitizenshipRequired : 'Not Mentioned';
  const usCitizenshipEvidence = rawUsCitizenshipEvidence ? rawUsCitizenshipEvidence : '';

  return {
    yearsOfExperience: typeof parsed?.yearsOfExperience === 'string'
      ? parsed.yearsOfExperience.trim() || 'Not specified'
      : 'Not specified',
    education,
    sponsorship,
    sponsorshipEvidence,
    usCitizenshipRequired,
    usCitizenshipEvidence,
    summary: typeof parsed?.summary === 'string' ? parsed.summary.trim() : '',
    keywords: Array.isArray(parsed?.keywords)
      ? parsed.keywords.filter(k => typeof k === 'string').map(k => k.trim()).filter(Boolean).slice(0, 12)
      : []
  };
}

// ─── Analyze endpoint ─────────────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const { jobDescription, userEmail } = req.body;

  if (!jobDescription || typeof jobDescription !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid jobDescription' });
  }
  if (!userEmail || typeof userEmail !== 'string') {
    return res.status(401).json({ error: 'Missing userEmail — sign in first' });
  }

  if (!checkRate(userEmail)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfigured — missing API key' });
  }

  try {
    const prompt = `Analyze the following LinkedIn job description and return ONLY a valid JSON object — no markdown fences, no explanation.

Return exactly this structure:
{
  "yearsOfExperience": "e.g. '3-5 years', '5+ years', or 'Not specified'",
  "education": "one of the exact labels listed below",
  "sponsorship": "Sponsors | Does Not Sponsor | Not Mentioned",
  "sponsorshipEvidence": "Exact sentence from the job description that supports the sponsorship label, or an empty string if not mentioned",
  "usCitizenshipRequired": "Required | Not Mentioned",
  "usCitizenshipEvidence": "Exact sentence from the job description that supports the citizenship label, or an empty string if not mentioned",
  "summary": "2-3 sentence overview of the role, team, and company",
  "keywords": ["8 to 12 job-specific technical or domain keywords"]
}

Rules:
- sponsorship: "Sponsors" if visa/work sponsorship is explicitly offered or clearly implied; "Does Not Sponsor" if explicitly stated they do not sponsor; "Not Mentioned" if the description is silent on sponsorship.
- sponsorshipEvidence: if sponsorship is "Sponsors" or "Does Not Sponsor", copy exactly one sentence from the job description that most directly supports that label. Do not paraphrase. If sponsorship is "Not Mentioned", return an empty string.
- usCitizenshipRequired: "Required" if any security clearance is required OR if US citizenship is explicitly required; "Not Mentioned" otherwise.
- usCitizenshipEvidence: if usCitizenshipRequired is "Required", copy exactly one sentence from the job description that most directly supports that label. Do not paraphrase. If it is "Not Mentioned", return an empty string.
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
- Evidence sentences must be copied verbatim from the provided job description text, preserving meaning and wording.
- If multiple sentences qualify, choose the single strongest sentence.
- Never return "Sponsors", "Does Not Sponsor", or "Required" unless you can also return an exact supporting sentence copied from the job description.
- If you cannot provide an exact supporting sentence for sponsorship or citizenship, set that field to "Not Mentioned" and leave its evidence string empty.

Job Description:
${jobDescription.slice(0, 4000)}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || `OpenAI error ${response.status}` });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    // Extract the outermost {...} by finding the first { and last }
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return res.status(502).json({ error: 'Could not parse response from AI.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return res.status(502).json({ error: 'AI returned malformed JSON.' });
    }

    res.json(normalizeAnalysis(parsed));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    name: 'JobInsight API',
    status: 'ok',
    health: '/api/health'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`JobInsight backend running on port ${PORT}`);
});
