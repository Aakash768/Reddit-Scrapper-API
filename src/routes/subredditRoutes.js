import express from 'express';
// Import specific controller functions - .js extension required
import {
    validateSubreddit,
    getSubredditPosts,
    getSubredditAbout
} from '../controllers/subredditController.js';

const router = express.Router();

// Route to validate subreddit existence and accessibility
// Example: GET /api/subreddit/learnjavascript/validate
router.get('/:name/validate', validateSubreddit);

// Route to get posts from a subreddit (sort determined by query param)
// Example: GET /api/subreddit/learnjavascript/posts?sort=new&limit=10
router.get('/:name/posts', getSubredditPosts);

// Route to get detailed subreddit metadata (about + rules)
router.get('/:name/about', getSubredditAbout);

// GET /api/subreddit/:name/comments

// Export the router as the default export
export default router; 