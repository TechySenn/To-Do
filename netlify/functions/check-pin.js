// netlify/functions/check-pin.js
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

exports.handler = async function(event, context) {
    // --- Initialize Supabase Client ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        console.error('CHECK-PIN: Missing Supabase credentials.');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    // --- End Initialization ---

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const { enteredPin } = JSON.parse(event.body);
        if (!enteredPin) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing enteredPin.' }) };
        }

        console.log("CHECK-PIN: Fetching stored pin hash...");
        // Fetch the hash from the settings table (assuming only one row with id=1)
        const { data, error: fetchError } = await supabase
            .from('settings') // Your settings table name
            .select('pin_hash')
            .eq('id', 1) // Assuming your settings row has id 1
            .single();

        if (fetchError || !data || !data.pin_hash) {
            console.error('CHECK-PIN: Error fetching pin hash or hash not found:', fetchError);
            return { statusCode: 500, body: JSON.stringify({ error: 'Could not retrieve security settings.' }) };
        }

        const storedHash = data.pin_hash;
        console.log("CHECK-PIN: Comparing entered pin with stored hash...");

        // Compare the entered pin with the stored hash
        const isValid = await bcrypt.compare(enteredPin, storedHash);

        console.log(`CHECK-PIN: Pin validation result: ${isValid}`);
        return {
            statusCode: 200,
            body: JSON.stringify({ valid: isValid }), // Return true or false
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
