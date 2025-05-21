// netlify/functions/add-task-from-automation.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // --- Environment Variables ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const expectedSecretKey = process.env.AUTOMATION_SECRET_KEY; // Store your secret key in Netlify env vars

    // --- Initialize Supabase Client ---
    if (!supabaseUrl || !supabaseKey) {
        console.error('ADD-TASK-AUTO: Missing Supabase credentials.');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error (Supabase).' }) };
    }
    if (!expectedSecretKey) {
        console.error('ADD-TASK-AUTO: Missing AUTOMATION_SECRET_KEY environment variable.');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error (Security).' }) };
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- Method and Security Check ---
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    let requestBody;
    try {
        requestBody = JSON.parse(event.body);
    } catch (e) {
        console.error('ADD-TASK-AUTO: Invalid JSON in request body.', e.message);
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON format.' }) };
    }

    const { task_title, due_date_string, notes_content, secret_key } = requestBody;

    if (secret_key !== expectedSecretKey) {
        console.warn('ADD-TASK-AUTO: Invalid or missing secret key.');
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: Invalid secret key.' }) };
    }

    if (!task_title || typeof task_title !== 'string' || task_title.trim() === '') {
        console.error("ADD-TASK-AUTO: Validation Error: Missing or invalid 'task_title'.");
        return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid 'task_title'." }) };
    }

    // --- Prepare Task Data for Supabase ---
    const newTaskData = {
        text: task_title.trim(),
        priority: "New", // Default priority
        notes: notes_content ? notes_content.trim() : '', // Optional notes
        status: "todo",   // Default status
        due_date: null,   // Default due date
        created_at: new Date().toISOString(), // Set creation timestamp
        // name: "Google Assistant" // Optional: to indicate source, if you have a 'name' column
    };

    // Process due_date_string if provided
    // Google Tasks API usually sends due date as 'YYYY-MM-DD' for date-only tasks.
    if (due_date_string) {
        const parsedDate = new Date(due_date_string);
        // Check if the date is valid. Google Tasks might send just the date part.
        // Adding time to ensure it's stored correctly if your Supabase column is a timestamp.
        // If it's a 'date' column, Supabase handles 'YYYY-MM-DD' fine.
        if (!isNaN(parsedDate.getTime())) {
            // Ensure it's treated as a full day if only date is provided
            // This sets it to the beginning of the day in UTC to avoid timezone issues if Supabase converts.
            // Or, if your Supabase column is just `date`, `YYYY-MM-DD` is fine.
            newTaskData.due_date = parsedDate.toISOString(); 
        } else {
            console.warn(`ADD-TASK-AUTO: Could not parse due_date_string: ${due_date_string}`);
        }
    }
    
    console.log("ADD-TASK-AUTO: Attempting to add task:", JSON.stringify(newTaskData, null, 2));

    // --- Insert into Supabase ---
    try {
        const { data, error } = await supabase
            .from('tasks') // Ensure this is your tasks table name
            .insert([newTaskData])
            .select(); // Optionally select the inserted data to return/log

        if (error) {
            console.error('ADD-TASK-AUTO: Supabase insert error:', error);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to add task to database.', details: error.message }) };
        }

        console.log("ADD-TASK-AUTO: Task added successfully via automation:", data);
        return {
            statusCode: 201, // 201 Created
            body: JSON.stringify({ message: 'Task added successfully via automation.', task: data }),
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) {
        console.error('ADD-TASK-AUTO: Function execution error during Supabase insert:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error during database operation.', details: err.message }) };
    }
};
