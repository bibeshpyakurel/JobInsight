// JobInsight Popup — Google OAuth & User Management

const GOOGLE_CLIENT_ID = '958968017622-fh9cn92tsf5vm06i0s4aoq296pom57vh.apps.googleusercontent.com';
const BACKEND_URL = 'https://jobinsight-6nyq.onrender.com';

async function checkBackendHealth() {
  const row  = document.getElementById('backendStatus');
  const text = document.getElementById('backendStatusText');
  if (!row || !text) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      row.className  = 'ji-backend-row ji-backend-row--ok';
      text.textContent = 'Backend online';
    } else {
      row.className  = 'ji-backend-row ji-backend-row--warn';
      text.textContent = `Backend error (${res.status})`;
    }
  } catch {
    row.className  = 'ji-backend-row ji-backend-row--warn';
    text.textContent = 'Backend offline — may be starting up';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  checkBackendHealth();
  const signInBtn = document.getElementById('signInBtn');
  const signOutBtn = document.getElementById('signOutBtn');
  const errorMsg = document.getElementById('errorMsg');
  const userEmailEl = document.getElementById('userEmailEl');
  const signedOutState = document.getElementById('state-signedout');
  const signedInState = document.getElementById('state-signedin');

  // Check if user is already signed in
  const { userEmail } = await chrome.storage.local.get(['userEmail']);

  if (userEmail) {
    showSignedInState(userEmail);
  }

  // Sign in with Google using Chrome's built-in identity API
  signInBtn.addEventListener('click', async () => {
    try {
      signInBtn.disabled = true;
      signInBtn.textContent = 'Signing in...';

      // Get OAuth token via Chrome identity API (works with Chrome Extension OAuth client)
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(token);
          }
        });
      });

      if (!token) {
        showError('Sign-in cancelled');
        signInBtn.disabled = false;
        signInBtn.textContent = 'Continue with Google';
        return;
      }

      // Fetch user info from Google
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!userResponse.ok) throw new Error('Failed to fetch user info');

      const userData = await userResponse.json();

      // Save user info locally
      await chrome.storage.local.set({
        userEmail: userData.email
      });

      showSignedInState(userData.email);
    } catch (err) {
      showError('Sign-in error: ' + err.message);
      signInBtn.disabled = false;
      signInBtn.textContent = 'Continue with Google';
    }
  });

  signOutBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(['userEmail']);
    showSignedOutState();
  });

  function showSignedInState(email) {
    signedOutState.style.display = 'none';
    signedInState.style.display = 'flex';
    userEmailEl.textContent = email;
    signInBtn.disabled = false;
    signInBtn.textContent = 'Continue with Google';
  }

  function showSignedOutState() {
    signedInState.style.display = 'none';
    signedOutState.style.display = 'flex';
    errorMsg.textContent = '';
    signInBtn.disabled = false;
    signInBtn.textContent = 'Continue with Google';
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    setTimeout(() => { errorMsg.textContent = ''; }, 5000);
  }
});
