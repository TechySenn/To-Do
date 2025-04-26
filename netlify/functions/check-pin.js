// netlify/functions/check-pin.js
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

exports.handler = async function(event, context) {
    // --- Check Environment Variables and Initialize Client INSIDE Handler ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('CHECK-PIN: Supabase URL or Service Key environment variable is missing.');
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
        const { enteredPin } = JSON.parse(event.body);
        if (!enteredPin) {
             console.error("CHECK-PIN: Missing enteredPin in request body.");
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing enteredPin.' }) };
        }

        console.log("CHECK-PIN: Fetching stored pin hash...");
        const { data, error: fetchError } = await supabase
            .from('settings')
            .select('pin_hash')
            .eq('id', 1)
            .single();

        if (fetchError || !data || !data.pin_hash) {
            console.error('CHECK-PIN: Error fetching pin hash or hash not found:', fetchError);
            return {
                 statusCode: 200, // Treat as invalid pin, not server error
                 body: JSON.stringify({ valid: false, error: 'Security settings not found or invalid.' })
            };
        }

        const storedHash = data.pin_hash;
        // *** ADDED LOGGING HERE ***
        console.log(`CHECK-PIN: Hash fetched from DB: ${storedHash}`);
        // **************************

        console.log("CHECK-PIN: Comparing entered pin with stored hash...");
        const isValid = await bcrypt.compare(enteredPin, storedHash);

        console.log(`CHECK-PIN: Pin validation result: ${isValid}`);
        return {
            statusCode: 200,
            body: JSON.stringify({ valid: isValid }),
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) {
        console.error('CHECK-PIN: Function execution error:', err);
         if (err instanceof SyntaxError) {
             return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON format in request body.' }) };
         }
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) };
    }
};
