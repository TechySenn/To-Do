// netlify/functions/get-sticky-note.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // --- Initialize Supabase Client ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        console.error('GET-STICKY: Missing Supabase credentials.');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    // --- End Initialization ---

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'GET' } };
    }

    let noteIdToFetch = 1; // Default to note ID 1 (original sticky note)

    // For GET requests, parameters are in event.queryStringParameters
    if (event.queryStringParameters && event.queryStringParameters.note_id) {
        const parsedId = parseInt(event.queryStringParameters.note_id);
        if (!isNaN(parsedId)) {
            noteIdToFetch = parsedId;
        } else {
            console.warn(`GET-STICKY: Invalid note_id '${event.queryStringParameters.note_id}' in query string, defaulting to 1.`);
        }
    } else {
        console.log('GET-STICKY: No note_id in query string, defaulting to 1.');
    }

    try {
        console.log(`GET-STICKY: Fetching sticky note content for ID: ${noteIdToFetch}...`);
        const { data, error } = await supabase
            .from('sticky_note') // Your sticky note table name
            .select('content')
            .eq('id', noteIdToFetch) // Use the determined note ID
            .single(); // Expecting only one row

        if (error) {
            if (error.code === 'PGRST116') { // Resource Not Found (e.g., row for ID doesn't exist)
                 console.log(`GET-STICKY: Sticky note row not found for ID ${noteIdToFetch}, returning empty.`);
                 return { statusCode: 200, body: JSON.stringify({ content: '' }), headers: { 'Content-Type': 'application/json' } };
            }
            // Otherwise, it's a different Supabase error
            console.error(`GET-STICKY: Supabase fetch error for ID ${noteIdToFetch}:`, error);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch sticky note', details: error.message }) };
        }

        console.log(`GET-STICKY: Sticky note content fetched for ID: ${noteIdToFetch}.`);
        return {
            statusCode: 200,
            body: JSON.stringify({ content: data?.content || '' }), // Default to empty string if content is null
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) {
        // Catch-all for other unexpected errors during function execution
        console.error(`GET-STICKY: Function execution error for ID ${noteIdToFetch}:`, err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) };
    }
};
