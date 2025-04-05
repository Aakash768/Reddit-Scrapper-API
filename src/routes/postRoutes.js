import express from 'express';
// Import specific controller function - .js extension required
import { getPostComments } from '../controllers/postController.js';

const router = express.Router();

// Route to get comments for a specific post
// Example: GET /api/post/19x4wqm/comments?depth=3&sort=new
router.get('/:postId/comments', getPostComments);

// --- Future Post/Comment Interaction Routes ---
// router.get('/comment/:commentId', getCommentDetails); // Example

// Export the router as the default export
export default router; 