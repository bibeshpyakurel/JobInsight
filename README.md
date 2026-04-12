# JobInsight — LinkedIn Job Analyzer Chrome Extension

AI-powered floating overlay that automatically analyzes LinkedIn job listings.

## Features

| Feature | Source |
|---|---|
| Years of experience required | Extracted from job description via AI |
| Education requirements | Extracted from job description via AI |
| E-Verify status | Extracted from job description via AI |
| H1B sponsorship | Extracted from job description via AI |
| Security clearance | Extracted from job description via AI |
| Job summary | AI-generated 2-3 sentence overview |
| Job-specific keywords | AI-extracted technical keywords |
| H1B filing history by year | h1bdata.info (click to expand) |

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select this folder (`JobInsight/`)

## Setup

1. Click the **JobInsight** icon in the Chrome toolbar
2. Enter your [Claude API key](https://console.anthropic.com/keys) (free to create)
3. Click **Save**

Your key is stored locally in Chrome storage and only sent to the Anthropic API.

## Usage

Open any LinkedIn job listing — the overlay appears automatically in the top-right corner.

- **Drag** the overlay to reposition it
- **−** button minimizes it
- Click **H1B History** to expand year-by-year filing counts

## File Structure

```
JobInsight/
├── manifest.json                  # Chrome extension config (Manifest V3)
├── background/
│   └── service-worker.js          # Claude API calls + H1B lookups
├── content/
│   ├── linkedin-scraper.js        # Page scraping + overlay injection
│   └── overlay.css                # Overlay styles
└── popup/
    ├── popup.html                 # Settings UI
    └── popup.js                   # API key save/load
```

## Cost

Uses Claude Haiku (fastest, cheapest model). Each job analysis costs roughly **$0.0003–0.0006** (less than a tenth of a cent).
