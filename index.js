import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config({
    path: "./.env" // Explicit path is good if .env isn't in the root where node is run
});

// Import app AFTER env vars are loaded
import app from './app.js';

const PORT = process.env.PORT || 3000; // Use PORT from .env, fallback to 3000

app.listen(PORT, () => {
    console.log(`⚙️  Server is running on port: ${PORT}`);
    // Optional: Add check here again if reddit client initialized successfully
    // Needs app to potentially export the client or a status flag if using ESM strictly
    // For simplicity, the check in app.js startup might be sufficient if app.js requires the service.
})
.on('error', (err) => {
    console.error('🚨 Failed to start server:', err);
    process.exit(1); // Exit if server fails to start
});