// netlify/functions/delete-task.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // --- Check Environment Variables and Initialize Client INSIDE Handler ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('DELETE-TASK: Supabase URL or Service Key environment variable is missing.'); // Added identifier
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: Missing Supabase credentials.' })
        };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    // --- End Check and Initialization ---

    // Often uses POST for delete via functions, but could use DELETE method too
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const { id } = JSON.parse(event.body);
        console.log(`DELETE-TASK: Received delete request for task ID: ${id}`);

        if (!id) {
            console.error("DELETE-TASK: Validation Error: Missing task ID.");
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing task ID.' }) };
        }

        console.log(`DELETE-TASK: Deleting task ${id} from Supabase...`);
        // Supabase delete returns only error, not data or count directly in v2 anymore
        // We check for error only.
        const { error } = await supabase
            .from('tasks') // Your table name
            .delete()
            .eq('id', id); // Specify which task to delete

        if (error) {
            console.error('DELETE-TASK: Supabase delete error:', error);
            // Check if the error indicates the row wasn't found (depends on Supabase/PostgREST version/config)
            // A common pattern is error.code related to 'PGRST116' or similar, or checking details.
            // For simplicity, we'll return 500 for any delete error for now.
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to delete task', details: error.message, code: error.code }) };
        }

        // If no error, assume deletion was successful (or the row didn't exist, which is fine for delete)
        console.log(`DELETE-TASK: Task ${id} deleted successfully (or did not exist).`);
        return {
            statusCode: 200, // OK status
            body: JSON.stringify({ message: 'Task deleted successfully', id: id }),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (err) {
        console.error('DELETE-TASK: Function execution error:', err);
         if (err instanceof SyntaxError) {
             return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON format in request body.' }) };
         }
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) };
    }
};
