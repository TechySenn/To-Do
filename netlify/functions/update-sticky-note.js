// netlify/functions/update-sticky-note.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // --- Initialize Supabase Client ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        console.error('UPDATE-STICKY: Missing Supabase credentials.');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    // --- End Initialization ---

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const { content } = JSON.parse(event.body);

        // Allow empty content, but check if content property exists
        if (typeof content === 'undefined') {
             console.error("UPDATE-STICKY: Validation Error: Missing 'content' field.");
             return { statusCode: 400, body: JSON.stringify({ error: "Missing 'content' field in request body." }) };
        }

        console.log("UPDATE-STICKY: Updating sticky note content...");
        const { error } = await supabase
            .from('sticky_note') // Your sticky note table name
            .update({ content: content }) // Update the content column
            .eq('id', 1); // Update the row where id = 1

        if (error) {
            console.error('UPDATE-STICKY: Supabase update error:', error);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update sticky note', details: error.message }) };
        }

        console.log("UPDATE-STICKY: Sticky note updated successfully.");
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Sticky note updated successfully.' }),
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) {
        console.error('UPDATE-STICKY: Function execution error:', err);
         if (err instanceof SyntaxError) {
             return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON format in request body.' }) };
         }
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) };
    }
};
