// netlify/functions/get-tasks.js
const { createClient } = require('@supabase/supabase-js');

// Ensure environment variables are loaded (Netlify does this automatically)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Use service key for backend

// Check if environment variables are set
if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase URL or Service Key is missing.');
    // Return an error response immediately if config is missing
    // Use return inside handler, or handle differently outside if needed
    // For simplicity in handler structure, we check inside:
    // exports.handler = async ... { if (!supabaseUrl || !supabaseKey) return { ... } }
    // But having it here ensures client isn't created with undefined values if check fails early.
    // A better pattern might be to initialize supabase inside the handler after checking env vars.
}

// Initialize Supabase client (might be null if vars are missing)
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

exports.handler = async function(event, context) {
    // Check for missing Supabase client due to missing env vars
    if (!supabase) {
         console.error('Supabase client could not be initialized. Check environment variables.');
         return {
             statusCode: 500,
             body: JSON.stringify({ error: 'Server configuration error: Supabase credentials missing or invalid.' }),
         };
    }

    // Only allow GET requests for fetching tasks
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405, // Method Not Allowed
            body: JSON.stringify({ error: 'Method Not Allowed' }),
            headers: { 'Allow': 'GET' },
        };
    }

    try {
        console.log("Fetching tasks from Supabase...");
        const { data, error } = await supabase
            .from('tasks') // Make sure 'tasks' matches your table name
            .select('*'); // Fetch all columns

        if (error) {
            console.error('Supabase fetch error:', error);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Failed to fetch tasks', details: error.message }),
            };
        }

        console.log(`Successfully fetched ${data.length} tasks.`);
        return {
            statusCode: 200,
            body: JSON.stringify(data), // Send the array of tasks back
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (err) {
        console.error('Function execution error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error', details: err.message }),
        };
    }
};
