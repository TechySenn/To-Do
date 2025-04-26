// netlify/functions/delete-task.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase URL or Service Key is missing.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
}

const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async function(event, context) {
    // Often uses POST for delete via functions, but could use DELETE method too
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const { id } = JSON.parse(event.body);
        console.log(`Received delete request for task ID: ${id}`);

        if (!id) {
            console.error("Validation Error: Missing task ID.");
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing task ID.' }) };
        }

        console.log(`Deleting task ${id}...`);
        const { error, count } = await supabase
            .from('tasks') // Your table name
            .delete()
            .eq('id', id); // Specify which task to delete

        if (error) {
            console.error('Supabase delete error:', error);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to delete task', details: error.message }) };
        }

        // Check if any row was actually deleted
        if (count === 0) {
             console.warn(`No task found with ID ${id} to delete.`);
             // You might return 404 or 200/204 depending on desired behavior
             return { statusCode: 404, body: JSON.stringify({ message: 'Task not found, nothing deleted.', id: id }) };
        }


        console.log(`Task ${id} deleted successfully.`);
        return {
            statusCode: 200, // Or 204 No Content if you prefer not sending a body
            body: JSON.stringify({ message: 'Task deleted successfully', id: id }),
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
