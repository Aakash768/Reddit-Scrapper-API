import redditApi from '../services/redditService.js'; // Import the configured Axios instance

/**
 * Handles Axios errors specifically, passing them to the general error handler.
 */
function handleAxiosError(error, next, defaultMessage = 'Error interacting with Reddit API') {
    console.error(defaultMessage, error.response ? error.response.data : error.message);
    const err = new Error(error.response?.data?.message || defaultMessage);
    err.status = error.response?.status || 500; // Use status from Reddit response if available
    next(err);
}

/**
 * Removes common Markdown and HTML formatting from text.
 */
function cleanDescriptionText(text) {
    if (!text) return ''; // Return empty string if input is null or undefined
    
    let cleanedText = text;
    
    // Remove HTML tags
    cleanedText = cleanedText.replace(/<[^>]*>/g, '');
    
    // Remove common Markdown link format [text](url) -> text
    cleanedText = cleanedText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    
    // Remove markdown headers (###), horizontal rules (----), list markers (*, -), bold/italic markers (*, _)
    cleanedText = cleanedText.replace(/^#+\s*|---|\*\*|__|\*|_/gm, '');
    
    // Replace multiple newlines/whitespace with a single space and trim
    cleanedText = cleanedText.replace(/\s\s+/g, ' ').trim();
    
    return cleanedText;
}

/**
 * Validates if a subreddit exists and is accessible by fetching its 'about' info.
 * GET /api/subreddit/:name/validate
 */
export const validateSubreddit = async (req, res, next) => {
    const { name: subredditName } = req.params;

    if (!subredditName) {
        const err = new Error('Subreddit name parameter is required.');
        err.status = 400;
        return next(err);
    }

    try {
        console.log(`Validating subreddit: r/${subredditName}`);
        const response = await redditApi.get(`/r/${subredditName}/about`);

        if (response.data && response.data.kind === 't5' && response.data.data) {
            const subData = response.data.data;
            console.log(`Validation successful for r/${subData.display_name}`);
            res.status(200).json({
                message: `Subreddit 'r/${subData.display_name}' is valid and accessible.`,
                name: subData.display_name,
                id: subData.name, 
                title: subData.title,
                subscribers: subData.subscribers,
                created_utc: subData.created_utc,
                public_description: subData.public_description,
                over18: subData.over_18,
                subreddit_type: subData.subreddit_type,
            });
        } else {
            throw new Error('Unexpected response structure received from Reddit API for subreddit validation.');
        }
    } catch (error) {
        // Check if it's an Axios error with a response from Reddit
        if (error.response) {
            // Specifically interpret 400 from /about as Not Found/Invalid
            if (error.response.status === 400) { 
                console.warn(`Subreddit r/${subredditName} validation failed (Reddit returned 400 for /about). Returning 404.`);
                // Return the 404 response directly instead of passing error to general handler
                return res.status(404).json({ message: `Subreddit 'r/${subredditName}' not found or invalid.` });
            } else {
                // Handle other Axios errors (403, 429, 5xx) using the helper which calls next()
                handleAxiosError(error, next, `Error validating subreddit r/${subredditName}`);
            }
        } else {
            // Handle non-Axios errors (e.g., network issues, code errors) by passing to general handler
            console.error(`Non-Axios error validating subreddit r/${subredditName}:`, error.message);
            const genericError = new Error('An unexpected error occurred during subreddit validation.');
            genericError.status = 500;
            next(genericError);
        }
    }
};

/**
 * Fetches posts from a subreddit, allowing manual override of common parameters via query string.
 * GET /api/subreddit/:name/posts
 * Query Params:
 *  - limit (number, default 25, max 100)
 *  - sort (string, default 'hot' | 'new' | 'top' | 'rising')
 *  - time (string, default 'day' | 'hour' | 'week' | 'month' | 'year' | 'all' - only applies if sort='top')
 *  - other params (e.g., after, before, count, show...) are passed through.
 */
export const getSubredditPosts = async (req, res, next) => {
    const { name: subredditName } = req.params;
    // Extract all potential params from query
    const { limit, sort, time, ...otherParams } = req.query;

    if (!subredditName) {
        const err = new Error('Subreddit name parameter is required.');
        err.status = 400;
        return next(err);
    }

    // --- Determine Effective Parameters with Validation and Defaults ---
    
    // Sort
    const allowedSorts = ['hot', 'new', 'top', 'rising'];
    const effectiveSort = (sort && allowedSorts.includes(sort.toLowerCase())) 
                            ? sort.toLowerCase() 
                            : 'hot'; // Default to hot

    // Limit
    let effectiveLimit = 25; // Default limit
    if (limit) {
        const parsedLimit = parseInt(limit, 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0 && parsedLimit <= 100) {
            effectiveLimit = parsedLimit;
        } else {
            const err = new Error('Invalid limit parameter provided. Must be a number between 1 and 100.');
            err.status = 400;
            return next(err);
        }
    }

    // Time (only relevant for sort='top')
    let effectiveTime = 'day'; // Default time
    const allowedTimes = ['hour', 'day', 'week', 'month', 'year', 'all'];
    if (effectiveSort === 'top') {
        if (time && allowedTimes.includes(time.toLowerCase())) {
            effectiveTime = time.toLowerCase();
        } else if (time) { // time provided but invalid for 'top' sort
            const err = new Error(`Invalid time parameter '${time}' for 'top' sort. Allowed values: ${allowedTimes.join(', ')}.`);
            err.status = 400;
            return next(err);
        }
        // If sort is top and no time provided, default 'day' is used
    }

    // --- Construct Reddit API Parameters ---
    const apiParams = {
        // Start with other pass-through parameters
        ...otherParams,
        // Add validated/defaulted known parameters
        limit: effectiveLimit,
        // Add time parameter 't' only if sort is 'top'
        ...(effectiveSort === 'top' && { t: effectiveTime }),
    };

    try {
        // Use the effectiveSort in the URL path
        console.log(`Fetching posts for r/${subredditName} (sort: ${effectiveSort}) with params:`, apiParams);
        
        const response = await redditApi.get(`/r/${subredditName}/${effectiveSort}`, {
            params: apiParams // Send the combined parameters
        });

        // --- Process the response ---
        if (response.data && response.data.kind === 'Listing' && Array.isArray(response.data.data?.children)) {
            const postsData = response.data.data.children;
            const after = response.data.data.after;
            const before = response.data.data.before;
            
            const posts = postsData.map(postWrapper => {
                const post = postWrapper.data; 
                
                // Determine Post Type
                let post_type = 'link'; // Default type
                if (post.is_video) {
                    post_type = 'video';
                } else if (post.is_gallery) {
                    post_type = 'gallery';
                } else if (post.is_self) {
                    post_type = 'text';
                } else if (post.post_hint === 'image') {
                    post_type = 'image';
                } else if (post.post_hint === 'link') {
                     post_type = 'link';
                } // Can add more checks if needed

                // Extract Media URL
                let media_url = post.url; // Default to post URL
                if (post_type === 'video' && post.media?.reddit_video?.fallback_url) {
                    media_url = post.media.reddit_video.fallback_url;
                } else if (post.url_overridden_by_dest) { // Often used for images/links
                     media_url = post.url_overridden_by_dest;
                } 

                // Extract Gallery URLs if applicable
                let gallery_urls = null;
                if (post.is_gallery && post.media_metadata) {
                    gallery_urls = Object.keys(post.media_metadata).map(mediaId => {
                        const item = post.media_metadata[mediaId];
                        if (item.status === 'valid' && item.e === 'Image') {
                            // Construct URL based on media ID and format (mimetype -> extension)
                            const format = item.m?.split('/')[1] || 'jpg'; // e.g., image/jpeg -> jpeg
                            return `https://i.redd.it/${item.id}.${format}`; 
                        }
                        // Handle other types (videos in galleries?) if needed - more complex
                        return null;
                    }).filter(url => url !== null); // Filter out nulls if some items weren't images
                }

                return {
                    id: post.id,
                    title: post.title,                           // Post Title
                    score: post.score,                           // Likes (Score)
                    author: post.author || '[deleted]',          // User name
                    subreddit: post.subreddit_name_prefixed,
                    created_utc: post.created_utc,               // Created timestamp
                    permalink: `https://www.reddit.com${post.permalink}`,
                    num_comments: post.num_comments,
                    is_self: post.is_self,
                    selftext: post.is_self ? post.selftext?.substring(0, 2000) : null, // Post Body (limited length)
                    over_18: post.over_18,                       // NSFW true/false
                    spoiler: post.spoiler,
                    stickied: post.stickied,
                    flair: post.link_flair_text || null,         // Flair / Tags
                    post_type: post_type,                        // Post Type (derived)
                    media_url: post_type !== 'text' ? media_url : null, // Media URL (relevant for non-text)
                    thumbnail: post.thumbnail && !['self', 'default', 'nsfw', 'spoiler', 'image', ''].includes(post.thumbnail) ? post.thumbnail : null,
                    gallery_urls: gallery_urls                   // Gallery URLs (array or null)
                };
            });

            console.log(`Successfully fetched ${posts.length} posts for r/${subredditName}.`);
            res.status(200).json({
                subreddit: subredditName,
                sort: effectiveSort,
                parameters_used: apiParams,
                post_count: posts.length,
                after: after, 
                before: before,
                posts: posts, // Contains the detailed post objects
            });
        } else {
             throw new Error('Unexpected response structure received from Reddit API for posts.');
        }

    } catch (error) {
        handleAxiosError(error, next, `Error fetching posts for r/${subredditName}`);
    }
};

/**
 * Fetches detailed metadata and rules for a given subreddit.
 * GET /api/subreddit/:name/about
 */
export const getSubredditAbout = async (req, res, next) => {
    const { name: subredditName } = req.params;

    if (!subredditName) {
        const err = new Error('Subreddit name parameter is required.');
        err.status = 400;
        return next(err);
    }

    try {
        console.log(`Fetching metadata for r/${subredditName}`);

        // Fetch main metadata and rules concurrently
        const [aboutResponse, rulesResponse] = await Promise.all([
            redditApi.get(`/r/${subredditName}/about`), 
            redditApi.get(`/r/${subredditName}/about/rules`)
        ]);

        // Check structure and extract data from /about response
        if (!aboutResponse.data || aboutResponse.data.kind !== 't5' || !aboutResponse.data.data) {
            throw new Error('Unexpected response structure from /about endpoint.');
        }
        const subData = aboutResponse.data.data;

        // Extract rules (handle cases where rules might be empty or endpoint fails gracefully)
        const rules = rulesResponse.data?.rules || []; 

        console.log(`Successfully fetched metadata for r/${subData.display_name}`);
        
        // Combine and send the desired metadata, cleaning text fields
        res.status(200).json({
            name: subData.display_name,
            id: subData.name, 
            title: subData.title,
            subscribers: subData.subscribers,
            active_user_count: subData.active_user_count, // Added active user count
            created_utc: subData.created_utc,
            // Apply cleaning function to description fields
            public_description: cleanDescriptionText(subData.public_description),
            header_title: subData.header_title, // Often empty
            description: cleanDescriptionText(subData.description), // Clean sidebar description
            // description_html: subData.description_html, // Optionally keep raw HTML
            over18: subData.over_18, // NSFW status
            subreddit_type: subData.subreddit_type,
            lang: subData.lang,
            url: `https://www.reddit.com${subData.url}`,
            rules: rules.map(rule => ({ // Format rules for clarity
                short_name: rule.short_name,
                // Apply cleaning function to rule description
                description: cleanDescriptionText(rule.description),
                // description_html: rule.description_html, // Optionally keep raw rule HTML
                kind: rule.kind, // e.g., 'link', 'all'
                created_utc: rule.created_utc,
                priority: rule.priority,
                violation_reason: rule.violation_reason,
            }))
        });

    } catch (error) {
        handleAxiosError(error, next, `Error fetching metadata for r/${subredditName}`);
    }
};

// Note: No need for module.exports = {...} when using named exports 