import redditApi from '../services/redditService.js'; // Import the configured Axios instance

/**
 * Handles Axios errors specifically, passing them to the general error handler.
 * (Consider moving this to a shared utils file if used in multiple controllers)
 */
function handleAxiosError(error, next, defaultMessage = 'Error interacting with Reddit API') {
    console.error(defaultMessage, error.response ? error.response.data : error.message);
    const err = new Error(error.response?.data?.message || defaultMessage);
    err.status = error.response?.status || 500; // Use status from Reddit response if available
    next(err);
}

/**
 * Recursive function to format comments from the raw Reddit API structure.
 * Also identifies and formats 'more' comment objects.
 */
const formatApiComments = (commentArray) => {
    if (!Array.isArray(commentArray)) return [];

    return commentArray.map(commentWrapper => {
        const kind = commentWrapper.kind;
        const comment = commentWrapper.data;

        // Handle 'more' comment placeholders
        if (kind === 'more') {
            return {
                type: 'more',
                id: comment.id, // ID of the 'more' object itself
                count: comment.count, // Number of comments hidden
                parent_id: comment.parent_id, // Parent of these hidden comments
                children_ids: comment.children || [], // IDs of comments to load
            };
        }
        
        // Handle regular 't1' comments
        if (kind === 't1') {
            const repliesData = comment.replies?.data?.children || [];
            return {
                type: 'comment',
                id: comment.id,
                author: comment.author || '[deleted]',
                body: comment.body,
                body_html: comment.body_html,
                score: comment.score,
                created_utc: comment.created_utc,
                stickied: comment.stickied,
                is_submitter: comment.is_submitter,
                permalink: `https://www.reddit.com${comment.permalink}`,
                parent_id: comment.parent_id,
                replies: formatApiComments(repliesData),
            };
        }
        
        return null; // Filter out unexpected kinds
    }).filter(c => c !== null);
};

/**
 * Fetches comments for a specific Reddit post using Axios.
 * GET /api/post/:postId/comments
 * Query Params:
 *  - limit (number, Reddit default/max applies)
 *  - depth (number, Reddit default/max applies)
 *  - sort (string, default 'confidence' | ...)
 *  - after (string, cursor for pagination - typically a comment ID or 'more' ID)
 *  - threaded (boolean, default: true)
 */
export const getPostComments = async (req, res, next) => {
    const { postId } = req.params;
    // Extract pagination/filtering params
    const { limit, depth, sort = 'confidence', after, ...otherParams } = req.query; 

    if (!postId) {
        const err = new Error('Post ID parameter is required.');
        err.status = 400;
        return next(err);
    }

    // --- Input Validation ---
    const allowedSorts = ['confidence', 'top', 'new', 'controversial', 'old', 'qa'];
    const lowerCaseSort = sort.toLowerCase();
    if (!allowedSorts.includes(lowerCaseSort)) {
         const err = new Error(`Invalid sort parameter. Allowed values: ${allowedSorts.join(', ')}.`);
         err.status = 400;
         return next(err);
    }

    // Validate optional params if provided
    let parsedDepth = depth ? parseInt(depth, 10) : undefined;
    if (depth && (isNaN(parsedDepth) || parsedDepth < 0)) {
        const err = new Error('Invalid depth parameter.');
        err.status = 400; return next(err);
    }
    if (parsedDepth && parsedDepth > 15) { // Reddit's effective depth limit can vary
        console.warn(`Requested comment depth ${parsedDepth} might be ignored by Reddit or lead to large responses.`);
    }

    let parsedLimit = limit ? parseInt(limit, 10) : undefined;
    // Reddit comment limits are less defined than post limits, don't enforce a strict max here
    if (limit && (isNaN(parsedLimit) || parsedLimit <= 0)) {
         const err = new Error('Invalid limit parameter.');
         err.status = 400; return next(err);
    }
    
    // Basic validation for 'after' if provided (should look like t1_... or t3_... or more_...)
    if (after && !/^(t[13]_|more_)/.test(after)) {
        const err = new Error('Invalid after parameter format.');
        err.status = 400; return next(err);
    }

    try {
        console.log(`Fetching comments for post ${postId} (sort: ${lowerCaseSort}, depth: ${parsedDepth ?? 'default'}, limit: ${parsedLimit ?? 'default'}, after: ${after ?? 'none'})`);

        // Construct API parameters
        const apiParams = {
            ...otherParams, // Pass through other relevant params like context, threaded, etc.
            sort: lowerCaseSort,
            article: postId, // The comments endpoint uses 'article' for post ID
            ...(parsedLimit !== undefined && { limit: parsedLimit }),
            ...(parsedDepth !== undefined && { depth: parsedDepth }),
            ...(after && { after: after }) // Include 'after' if provided
        };

        // Make the API call - comments endpoint is /comments/:article
        // Note: We pass article in the params, not the path for this specific call
        const response = await redditApi.get(`/comments/${postId}`, { // Path includes postId for clarity/routing, but article param is key
            params: apiParams
        });

        if (Array.isArray(response.data) && response.data.length >= 2) {
            const postListing = response.data[0];
            const commentListing = response.data[1];
            const postDetails = postListing?.data?.children?.[0]?.data || {};
            const commentsData = commentListing?.data?.children || [];
            const formattedComments = formatApiComments(commentsData);

            // Extract the top-level 'after' cursor if present (usually null here, rely on 'more' objects)
            const listingAfter = commentListing?.data?.after;

            console.log(`Successfully fetched comments batch for post ${postId}. Count: ${formattedComments.length}`);
            res.status(200).json({
                postId: postId,
                postTitle: postDetails.title || 'N/A',
                postAuthor: postDetails.author || '[deleted]',
                subreddit: postDetails.subreddit_name_prefixed || 'N/A',
                sort: lowerCaseSort,
                parameters_used: apiParams,
                comment_count_this_batch: formattedComments.length, 
                after: listingAfter, // Include the listing 'after' (often null)
                comments: formattedComments, // Includes 'more' objects for pagination
            });
        } else {
            throw new Error('Unexpected response structure received from Reddit API for comments.');
        }

    } catch (error) {
         handleAxiosError(error, next, `Error fetching comments for post ${postId}`);
    }
}; 