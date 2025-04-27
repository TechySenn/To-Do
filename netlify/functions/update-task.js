// netlify/functions/update-task.js
const { createClient } = require('@supabase/supabase-js');

// Define valid statuses here as well for validation
const VALID_STATUSES = ['todo', 'inprogress', 'nonurgent', 'done'];
const PRIORITIES = ["New", "High", "Medium", "Low"]; // Keep for priority validation

exports.handler = async function(event, context) {
    // --- Check Environment Variables and Initialize Client INSIDE Handler ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('UPDATE-TASK: Supabase URL or Service Key environment variable is missing.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: Missing Supabase credentials.' })
        };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    // --- End Check and Initialization ---

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const { id, updates } = JSON.parse(event.body);
        console.log(`UPDATE-TASK: Received request for ID: ${id}`, updates);

        if (!id || !updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
            console.error("UPDATE-TASK: Validation Error: Missing task ID or updates object.");
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing task ID or updates data.' }) };
        }

        // --- Validate specific updates ---
        if (updates.status && !VALID_STATUSES.includes(updates.status)) {
             console.error(`UPDATE-TASK: Invalid status value: ${updates.status}`);
             return { statusCode: 400, body: JSON.stringify({ error: `Invalid status value: ${updates.status}` }) };
        }
         if (updates.priority && !PRIORITIES.includes(updates.priority)) {
             console.error(`UPDATE-TASK: Invalid priority value: ${updates.priority}`);
             return { statusCode: 400, body: JSON.stringify({ error: `Invalid priority value: ${updates.priority}` }) };
         }
         // Add other validation as needed (e.g., for notes length, text format etc.)
         // --- End Validation ---


        console.log(`UPDATE-TASK: Updating task ${id} with:`, updates);
        const { data, error } = await supabase
            .from('tasks')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('UPDATE-TASK: Supabase update error:', error);
             if (error.code === 'PGRST116') {
                 return { statusCode: 404, body: JSON.stringify({ error: 'Task not found', id: id }) };
             }
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update task in database', details: error.message, code: error.code }) };
        }

        if (!data) {
             console.warn(`UPDATE-TASK: Update successful but no data returned for task ${id}. Check RLS.`);
             return { statusCode: 200, body: JSON.stringify({ message: 'Update successful but no data returned', id: id }) };
        }

        console.log("UPDATE-TASK: Task updated successfully:", data);
        return {
            statusCode: 200,
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (err) {
        console.error('UPDATE-TASK: Function execution error:', err);
         if (err instanceof SyntaxError) {
             return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON format in request body.' }) };
         }
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) };
    }
};
