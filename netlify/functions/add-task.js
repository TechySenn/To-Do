// netlify/functions/add-task.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    const supabaseUrl = process.env.SUPABASE_URL;
    // Use the specific environment variable names you have in Netlify
    // Prioritize SERVICE_KEY for backend operations like insert
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Supabase URL or Key (SERVICE_KEY or ANON_KEY) environment variable is missing.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: Missing Supabase credentials.' })
        };
    }
    
    // Log which key is being used (only for debugging, remove or be cautious in production)
    // Be careful not to log the full key.
    if (process.env.SUPABASE_SERVICE_KEY) {
        console.log("Using SUPABASE_SERVICE_KEY for Supabase client.");
    } else if (process.env.SUPABASE_ANON_KEY) {
        console.log("Using SUPABASE_ANON_KEY for Supabase client (SERVICE_KEY was not found). RLS will apply strictly.");
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
        const priorityToInsert = requestBody.priority || "New";
        const statusToInsert = requestBody.status || "todo";
        const notesToInsert = requestBody.notes || '';
        const dueDateToInsert = requestBody.due_date || null;

        // 3. Construct the object to be inserted into Supabase
        const newTask = {
            text: requestBody.text.trim(),
            priority: priorityToInsert,
            status: statusToInsert,
            notes: notesToInsert,
            due_date: dueDateToInsert,
            created_at: new Date().toISOString(),
        };

        console.log("Inserting new task into Supabase:", newTask);
        
        const { data, error } = await supabase
            .from('tasks') // Ensure 'tasks' is your correct table name
            .insert([newTask])
            .select() 
            .single(); 

        if (error) {
            console.error('Supabase insert error:', error);
            // Check if the error is specifically an RLS violation, even with service key
            // (This would be unusual if the service key is correct and truly the service_role key from Supabase)
            if (error.message.includes("violates row-level security policy")) {
                 console.error("RLS policy violation detected even with the provided Supabase key. Please ensure the key used has RLS bypass privileges (typically SERVICE_ROLE_KEY).");
            }
            return { 
                statusCode: 500, 
                body: JSON.stringify({ error: 'Failed to add task to database.', details: error.message }) 
            };
        }

        console.log("Task added successfully to Supabase:", data);
        return {
            statusCode: 201, 
            body: JSON.stringify(data), 
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) { 
         console.error('Function execution error in add-task:', err);
         if (err instanceof SyntaxError) { 
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