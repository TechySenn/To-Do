// netlify/functions/add-task.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase URL or Service Key is missing.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
}

const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async function(event, context) {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const taskData = JSON.parse(event.body);
        console.log("Received task data:", taskData);

        // Validate required fields (add more checks as needed)
        if (!taskData || !taskData.text || !taskData.name || !taskData.priority || !taskData.status) {
             console.error("Validation Error: Missing required task fields.");
             return { statusCode: 400, body: JSON.stringify({ error: 'Missing required task fields (text, name, priority, status).' }) };
        }

        // Prepare data for Supabase (match column names)
        const newTask = {
            text: taskData.text,
            name: taskData.name,
            priority: taskData.priority,
            notes: taskData.notes || '', // Handle optional notes
            status: taskData.status,
            // Supabase handles 'id' and 'created_at' automatically if configured
        };

        console.log("Inserting new task:", newTask);
        const { data, error } = await supabase
            .from('tasks') // Your table name
            .insert([newTask])
            .select() // Select the newly inserted row to return it
            .single(); // Expecting only one row back

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
         // Handle JSON parsing errors specifically
         if (err instanceof SyntaxError) {
             return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON format in request body.' }) };
         }
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) };
    }
};
