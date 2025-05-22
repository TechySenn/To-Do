// netlify/functions/add-task.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    const supabaseUrl = process.env.SUPABASE_URL;
    // IMPORTANT: For write operations, it's generally recommended to use the SERVICE_ROLE_KEY
    // if your RLS policies for 'tasks' table don't allow 'anon' key to insert.
    // If your RLS policies DO allow anon key to insert, then SUPABASE_ANON_KEY can be used.
    // For simplicity and common setup, SERVICE_ROLE_KEY is often used for server-side functions
    // that need to bypass RLS for direct table writes.
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Supabase URL or Key environment variable is missing.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: Missing Supabase credentials.' })
        };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method Not Allowed' }), 
            headers: { 'Allow': 'POST' } 
        };
    }

    try {
        const requestBody = JSON.parse(event.body);
        console.log("Received data for new task:", requestBody);

        // 1. Validate that 'text' (task description) is provided
        if (!requestBody || !requestBody.text || typeof requestBody.text !== 'string' || requestBody.text.trim() === '') {
             console.error("Validation Error: Missing or invalid 'text' field for the task.");
             return { 
                 statusCode: 400, 
                 body: JSON.stringify({ error: "Missing required task field: text." }) 
             };
        }

        // 2. Set defaults for priority and status.
        //    Frontend should ideally send these, but backend ensures they are set.
        const priorityToInsert = requestBody.priority || "New";
        const statusToInsert = requestBody.status || "todo";
        const notesToInsert = requestBody.notes || '';
        const dueDateToInsert = requestBody.due_date || null;

        // 3. Construct the object to be inserted into Supabase
        //    'name' field is completely removed.
        const newTask = {
            text: requestBody.text.trim(),
            priority: priorityToInsert,
            status: statusToInsert,
            notes: notesToInsert,
            due_date: dueDateToInsert,
            created_at: new Date().toISOString(), // Backend sets the authoritative creation timestamp
            // If you have an 'updated_at' column, you might want to set it here as well:
            // updated_at: new Date().toISOString(), 
        };

        console.log("Inserting new task into Supabase:", newTask);
        
        const { data, error } = await supabase
            .from('tasks') // Ensure 'tasks' is your correct table name
            .insert([newTask])
            .select() // Select the inserted row(s) to return
            .single(); // Assuming insert results in a single new row

        if (error) {
            console.error('Supabase insert error:', error);
            return { 
                statusCode: 500, 
                body: JSON.stringify({ error: 'Failed to add task to database.', details: error.message }) 
            };
        }

        console.log("Task added successfully to Supabase:", data);
        return {
            statusCode: 201, // HTTP 201 Created is standard for successful resource creation
            body: JSON.stringify(data), // Send the newly created task back (includes ID from DB)
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) { // Catches errors from JSON.parse or other unexpected issues
         console.error('Function execution error in add-task:', err);
         if (err instanceof SyntaxError) { // Specifically for JSON.parse errors
             return { 
                 statusCode: 400, 
                 body: JSON.stringify({ error: 'Invalid JSON format in request body.' }) 
             };
         }
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) 
        };
    }
};