const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Only allow requests from your Chrome extension
app.use(cors({
  origin: (origin, cb) => {
    // Chrome extensions send origin as chrome-extension://<id>
    if (!origin || origin.startsWith('chrome-extension://')) {
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

function checkRate(email) {
  const now = Date.now();
  const entry = rateMap.get(email);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateMap.set(email, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
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
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: 'Could not parse response from AI.' });
    }

    res.json(JSON.parse(jsonMatch[0]));
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
