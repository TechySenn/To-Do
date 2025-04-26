// netlify/functions/get-tasks.js (Simplified for Testing)

exports.handler = async function(event, context) {
    console.log("Simplified get-tasks function invoked."); // Add a log

    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
            headers: { 'Allow': 'GET' },
        };
    }

    try {
        // Return hardcoded dummy data instead of calling Supabase
        const dummyTasks = [
            { id: 'dummy-1', created_at: new Date().toISOString(), text: 'Test Task 1 (Dummy)', name: 'Tester', priority: 'High', notes: 'Note 1', status: 'todo' },
            { id: 'dummy-2', created_at: new Date().toISOString(), text: 'Test Task 2 (Dummy)', name: 'Tester', priority: 'Medium', notes: '', status: 'inprogress' }
        ];

        console.log("Returning dummy task data.");
        return {
            statusCode: 200,
            body: JSON.stringify(dummyTasks), // Send dummy array
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) {
        // This catch block might not even be reached if the error is very basic
        console.error('Simplified function execution error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error in simplified function', details: err.message }),
        };
    }
};
