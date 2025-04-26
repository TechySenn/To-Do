// netlify/functions/update-task.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase URL or Service Key is missing.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
}

const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async function(event, context) {
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

        // Optional: Validate the fields being updated if necessary
        // e.g., ensure status is one of 'todo', 'inprogress', 'done'
        // e.g., ensure priority is one of the allowed values

        console.log(`Updating task ${id} with:`, updates);
        const { data, error } = await supabase
            .from('tasks') // Your table name
            .update(updates)
            .eq('id', id) // Specify which task to update
            .select() // Select the updated row
            .single(); // Expecting one row back

        if (error) {
            console.error('Supabase update error:', error);
            // Handle specific errors like task not found (e.g., error.code === 'PGRST116')
             if (error.code === 'PGRST116') { // PostgREST code for "Resource Not Found"
                 return { statusCode: 404, body: JSON.stringify({ error: 'Task not found', id: id }) };
             }
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update task', details: error.message }) };
        }

        if (!data) {
             console.warn(`Update successful but no data returned for task ${id}. Might indicate task was already deleted.`);
             return { statusCode: 404, body: JSON.stringify({ error: 'Task not found after update attempt', id: id }) };
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
