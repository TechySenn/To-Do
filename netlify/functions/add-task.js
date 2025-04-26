// netlify/functions/add-task.js
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

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const taskData = JSON.parse(event.body);
        console.log("Received task data:", taskData);

        // Validate required fields
        if (!taskData || !taskData.text || !taskData.name || !taskData.priority || !taskData.status) {
             console.error("Validation Error: Missing required task fields.");
             return { statusCode: 400, body: JSON.stringify({ error: 'Missing required task fields (text, name, priority, status).' }) };
        }

        const newTask = {
            text: taskData.text,
            name: taskData.name,
            priority: taskData.priority,
            notes: taskData.notes || '',
            status: taskData.status,
        };

        console.log("Inserting new task:", newTask);
        // Using .select().single() again, assuming RLS/connection is okay now that get-tasks works
        const { data, error } = await supabase
            .from('tasks')
            .insert([newTask])
            .select()
            .single();

        if (error) {
            console.error('Supabase insert error:', error);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to add task', details: error.message }) };
        }

        console.log("Task added successfully:", data);
        return {
            statusCode: 201, // 201 Created
            body: JSON.stringify(data), // Send the newly created task back
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
