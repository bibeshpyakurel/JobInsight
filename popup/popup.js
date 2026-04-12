// JobInsight Popup — API Key Settings

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const showKeyCheckbox = document.getElementById('showKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');

  // Load saved key
  const { openaiApiKey } = await chrome.storage.local.get('openaiApiKey');
  if (openaiApiKey) {
    apiKeyInput.value = openaiApiKey;
  }

  // Toggle visibility
  showKeyCheckbox.addEventListener('change', () => {
    apiKeyInput.type = showKeyCheckbox.checked ? 'text' : 'password';
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();

    if (!key) {
      showStatus('Please enter a valid API key.', true);
      return;
    }

    if (!key.startsWith('sk-')) {
      showStatus('Key should start with sk-…', true);
      return;
    }

    await chrome.storage.local.set({ openaiApiKey: key });
    showStatus('Saved! Open a LinkedIn job to analyze.', false);
  });

  function showStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = isError ? 'status error' : 'status';
    setTimeout(() => { statusEl.textContent = ''; }, 3500);
  }
});
