import axios from 'axios';
import axiosRetry from 'axios-retry'; // Import axios-retry
import dotenv from 'dotenv';

// Load environment variables immediately (though index.js should also do this)
// This ensures they are available if this module is imported elsewhere before index runs fully.
dotenv.config();

const REDDIT_API_BASE_URL = 'https://oauth.reddit.com';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

const clientId = process.env.REDDIT_CLIENT_ID;
const clientSecret = process.env.REDDIT_CLIENT_SECRET;
const userAgent = process.env.REDDIT_USER_AGENT;

// Configurable options (could also be from .env)
const BASE_REQUEST_DELAY_MS = 1100; // Add ~1.1 second delay between requests
const RETRY_COUNT = 3;

// Basic check for essential credentials
if (!clientId || !clientSecret || !userAgent) {
    console.error('FATAL ERROR: Missing Reddit API credentials (CLIENT_ID, CLIENT_SECRET, USER_AGENT) in environment variables.');
    // Optionally exit or prevent further execution
    process.exit(1);
}

let accessToken = null;
let tokenExpiry = null;
let isFetchingToken = false; // Simple flag to prevent concurrent token requests
let lastRequestTime = 0; // Track time of last request

/**
 * Fetches an application-only access token from Reddit.
 * Uses Basic Authentication with Client ID and Client Secret.
 */
async function getAppOnlyToken() {
    if (isFetchingToken) {
        console.log('Token fetch already in progress, waiting...');
        // Basic wait mechanism - could be improved with Promises
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        return accessToken; // Return potentially updated token
    }

    isFetchingToken = true;
    console.log('Fetching new Reddit application-only access token...');

    try {
        const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        
        const response = await axios.post(REDDIT_TOKEN_URL, 
            'grant_type=client_credentials', // Form data
            {
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'User-Agent': userAgent,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (response.data && response.data.access_token) {
            accessToken = response.data.access_token;
            // Calculate expiry time (response.data.expires_in is in seconds)
            // Subtract a buffer (e.g., 60 seconds) to request a new token before actual expiry
            tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000; 
            console.log('Successfully obtained Reddit access token.');
            isFetchingToken = false;
            return accessToken;
        } else {
            throw new Error('Invalid response received from Reddit token endpoint');
        }
    } catch (error) {
        console.error('Error fetching Reddit access token:', error.response ? error.response.data : error.message);
        accessToken = null; 
        tokenExpiry = null;
        isFetchingToken = false;
        // Depending on the error, you might want to throw it to stop the application
        // or allow retries later.
        throw new Error(`Failed to obtain Reddit access token. Check credentials and Reddit status. ${error.message}`); 
    }
}

/**
 * Checks if the current token is valid (exists and not expired).
 */
function isTokenValid() {
    return accessToken && tokenExpiry && Date.now() < tokenExpiry;
}

/**
 * Creates an Axios instance configured for making authenticated requests to the Reddit API.
 * Includes token refresh, request delay, and retry logic.
 */
const redditApi = axios.create({
    baseURL: REDDIT_API_BASE_URL,
    headers: {
        'User-Agent': userAgent
    }
});

// Axios request interceptor
redditApi.interceptors.request.use(async (config) => {
    // 1. Enforce Delay Between Requests
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < BASE_REQUEST_DELAY_MS) {
        const delay = BASE_REQUEST_DELAY_MS - timeSinceLastRequest;
        console.log(`Delaying request by ${delay}ms to respect rate limits...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    // Update last request time *before* making the request
    lastRequestTime = Date.now(); 

    // 2. Check and Refresh Token
    if (!isTokenValid()) {
        console.log('Access token invalid or expired, fetching new token...');
        try {
            await getAppOnlyToken(); // Fetch new token
        } catch (tokenError) {
            console.error('Failed to refresh token during request interception:', tokenError);
            return Promise.reject(tokenError); 
        }
    }
    
    // 3. Add Authorization Header
    if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
    } else {
        // This shouldn't happen if getAppOnlyToken worked, but handle defensively
        console.error('Cannot make API request: No valid access token available.');
        return Promise.reject(new Error('No valid access token available'));
    }

    return config;
}, (error) => {
    // Handle request configuration errors
    return Promise.reject(error);
});

// Configure axios-retry
axiosRetry(redditApi, {
    retries: RETRY_COUNT, // Number of retries
    retryDelay: (retryCount, error) => {
        // Calculate exponential backoff delay
        // Example: 1st retry: 1s, 2nd: 2s, 3rd: 4s
        const delay = Math.pow(2, retryCount - 1) * 1000; 
        console.warn(`Rate limit hit (attempt ${retryCount}). Retrying in ${delay / 1000}s...`);
        return delay;
    },
    retryCondition: (error) => {
        // Retry only on 429 (Too Many Requests) or specific network errors
        return error.response?.status === 429 || axiosRetry.isNetworkOrIdempotentRequestError(error);
    },
    shouldResetTimeout: true, // Reset timeout on retries
});

// --- Initial Token Fetch --- 
// Immediately try to fetch a token when the service loads.
// This is async, so subsequent imports might get the axios instance before
// the token is ready, but the interceptor will handle fetching it on the first request.
getAppOnlyToken().catch(error => {
    console.error("Initial token fetch failed on service load:", error.message);
    // The application might still run, but API calls will fail until a token is obtained.
});


// Export the configured Axios instance as the primary way to interact with the API
export default redditApi;

// You could also export helper functions if needed, e.g.:
// export { getAppOnlyToken }; 