# JobInsight — LinkedIn Job Analyzer

A Chrome extension that automatically analyzes LinkedIn job postings and shows a floating overlay with key details extracted by AI.

## What it shows

- **Experience** — years required
- **Education** — degree level and whether required or preferred
- **Sponsorship** — Sponsors / Does Not Sponsor / Not Mentioned
- **US Citizenship** — flags if citizenship or security clearance is required
- **Summary** — 2-3 sentence overview of the role
- **Keywords** — job-specific technical terms, highlighted in the job description

## Installation

1. Go to `chrome://extensions` in Chrome
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** and select this folder

## Setup

1. Click the **JobInsight** icon in the Chrome toolbar
2. Enter your [OpenAI API key](https://platform.openai.com/api-keys)
3. Click **Save**

Your key is stored locally in Chrome and only sent to the OpenAI API.

## Usage

Open any LinkedIn job listing — the overlay appears automatically in the top-right corner. Drag it to reposition, or resize it from any edge.

Results are cached for 7 days so re-opening the same job is instant.

## File structure

```
JobInsight/
├── manifest.json               # Chrome MV3 config
├── background/
│   └── service-worker.js       # OpenAI API calls
├── content/
│   ├── linkedin-scraper.js     # Page scraping + overlay logic
│   └── overlay.css             # Overlay styles
└── popup/
    ├── popup.html              # Settings UI
    └── popup.js                # API key save/load
```

## Cost

Uses GPT-4o-mini. Each job analysis costs roughly **$0.0003–0.0005** — less than a tenth of a cent.
