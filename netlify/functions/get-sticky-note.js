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

    try {
        console.log("GET-STICKY: Fetching sticky note content...");
        // Fetch the note content from the row where id = 1
        const { data, error } = await supabase
            .from('sticky_note') // Your sticky note table name
            .select('content')
            .eq('id', 1) // Assuming the note row has id 1
            .single(); // Expecting only one row

        if (error) {
            // If the row doesn't exist yet, return empty content gracefully
            if (error.code === 'PGRST116') { // Resource Not Found
                 console.log("GET-STICKY: Sticky note row not found, returning empty.");
                 return { statusCode: 200, body: JSON.stringify({ content: '' }), headers: { 'Content-Type': 'application/json' } };
            }
            // Otherwise, it's a real error
            console.error('GET-STICKY: Supabase fetch error:', error);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch sticky note', details: error.message }) };
        }

        console.log("GET-STICKY: Sticky note content fetched.");
        return {
            statusCode: 200,
            // Return the content, defaulting to empty string if null/undefined
            body: JSON.stringify({ content: data?.content || '' }),
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) {
        console.error('GET-STICKY: Function execution error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) };
    }
};
