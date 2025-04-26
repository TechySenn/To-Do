// netlify/functions/update-task.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // --- Check Environment Variables and Initialize Client INSIDE Handler ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Supabase URL or Service Key environment variable is missing.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: Missing Supabase credentials.' })
        };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    // --- End Check and Initialization ---

    // Only allow POST requests (or PUT/PATCH if preferred)
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const { id, updates } = JSON.parse(event.body);
        console.log(`Received update request for task ID: ${id}`, updates);

        if (!id || !updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
            console.error("Validation Error: Missing task ID or updates object.");
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing task ID or updates data.' }) };
        }

        // Optional: Add more specific validation for 'updates' content here
        // For example, check if 'status' is one of the allowed values if present

        console.log(`Updating task ${id} with:`, updates);
        const { data, error } = await supabase
            .from('tasks') // Your table name
            .update(updates)
            .eq('id', id) // Specify which task to update
            .select() // Select the updated row
            .single(); // Expecting one row back

        if (error) {
            console.error('Supabase update error:', error);
             if (error.code === 'PGRST116') { // PostgREST code for "Resource Not Found"
                 return { statusCode: 404, body: JSON.stringify({ error: 'Task not found', id: id }) };
             }
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update task', details: error.message }) };
        }

        // Supabase returns the updated data in the 'data' variable if .select() is used
        if (!data) {
             // This case might occur if RLS prevents seeing the updated row even after successful update
             console.warn(`Update might have succeeded but no data returned for task ${id}. Check RLS.`);
             // Returning 200 but with a warning might be better than 404 if the update likely worked
             return { statusCode: 200, body: JSON.stringify({ message: 'Update successful but no data returned', id: id }) };
        }

        console.log("Task updated successfully:", data);
        return {
            statusCode: 200,
            body: JSON.stringify(data), // Send the updated task back
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (err) {
        console.error('Function execution error:', err);
         if (err instanceof SyntaxError) {
             return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON format in request body.' }) };
         }
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) };
    }
};
