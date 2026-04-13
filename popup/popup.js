// JobInsight Popup — Google OAuth & User Management

const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com';

document.addEventListener('DOMContentLoaded', async () => {
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

  // Sign in with Google
  signInBtn.addEventListener('click', async () => {
    try {
      signInBtn.disabled = true;
      signInBtn.textContent = 'Signing in...';

      // Simple Google OAuth flow
      const redirectUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          {
            url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&response_type=token&scope=profile%20email&redirect_uri=https://${chrome.runtime.id}.chromiumapp.org/`,
            interactive: true
          },
          (url) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(url);
            }
          }
        );
      });

      if (!redirectUrl) {
        showError('Sign-in cancelled');
        signInBtn.disabled = false;
        signInBtn.textContent = 'Continue with Google';
        return;
      }

      // Extract token from redirect URL
      const tokenMatch = redirectUrl.match(/access_token=([^&]+)/);
      if (!tokenMatch) {
        showError('Failed to get access token');
        signInBtn.disabled = false;
        signInBtn.textContent = 'Continue with Google';
        return;
      }

      const accessToken = tokenMatch[1];

      // Fetch user info from Google
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
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
