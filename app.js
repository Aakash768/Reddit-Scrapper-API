import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser'; // You included this, keeping it for now

// Import routes - .js extension is required for local files in ES Modules
import subredditRoutes from './src/routes/subredditRoutes.js';
import postRoutes from './src/routes/postRoutes.js';

// dotenv.config() should be in index.js (or your entry point), not here.

const app = express();

// --- Middleware ---
// Security headers
app.use(helmet());
// Enable CORS for all origins (adjust in production!)
app.use(cors({ 
    origin: process.env.CORS_ORIGIN || '*', // Allow specific origin or all
    credentials: true // If you need cookies/auth headers
})); 

// Parse JSON request bodies
app.use(express.json({ limit: '16kb' })); // Example: Limit request body size
// Parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
// Serve static files (if you have a 'public' directory)
app.use(express.static("public"));
// Parse cookies
app.use(cookieParser());

// HTTP request logger (use 'dev' format for development)
// Only use morgan in development to avoid logging in production unless needed
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// --- Routes ---
// Root route check (updated)
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Reddit Scraper API is running!',
        status: 'OK',
        timestamp: new Date().toISOString(),
    });
});

// Mount API routes
app.use('/api/subreddit', subredditRoutes);
app.use('/api/post', postRoutes);
// app.use('/api/comments', commentRoutes); // Example for future

// --- Error Handling Middleware ---
// 404 Handler (if no route matched)
app.use((req, res, next) => {
    // Create an error object with a 404 status
    const error = new Error(`Not Found - ${req.originalUrl}`);
    error.status = 404;
    // Pass the error to the next middleware (the general error handler)
    next(error); 
});

// General Error Handler (catches errors passed via next(error))
// Needs all 4 arguments (err, req, res, next) to be recognized as an error handler by Express
app.use((err, req, res, next) => {
    // **REMOVED:** console.error log to prevent terminal output for handled errors.
    // console.error('Error caught by general error handler:', err.message, err.stack);

    // Set a default status code if none is attached
    const statusCode = err.status || 500;
    const message = err.message || 'Internal Server Error';

    // Send a JSON error response
    res.status(statusCode).json({
        message: message,
        // Optionally include stack trace in development only for debugging
        // NOTE: Stack trace is still included in JSON response if NODE_ENV is 'development'
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});

// Export the app instance
export default app;

