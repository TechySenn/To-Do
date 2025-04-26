// netlify/functions/update-pin.js
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

exports.handler = async function(event, context) {
    // --- Initialize Supabase Client ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        console.error('UPDATE-PIN: Missing Supabase credentials.');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    // --- End Initialization ---

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const { currentPin, newPin } = JSON.parse(event.body);

        if (!currentPin || !newPin) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing currentPin or newPin.' }) };
        }
         if (newPin.trim().length === 0) { // Basic validation
             return { statusCode: 400, body: JSON.stringify({ error: 'New pin cannot be empty.' }) };
         }

        console.log("UPDATE-PIN: Fetching stored pin hash...");
        // Fetch the current hash
        const { data: settingsData, error: fetchError } = await supabase
            .from('settings')
            .select('pin_hash')
            .eq('id', 1) // Assuming id 1 for the settings row
            .single();

        if (fetchError || !settingsData || !settingsData.pin_hash) {
            console.error('UPDATE-PIN: Error fetching current pin hash or hash not found:', fetchError);
            return { statusCode: 500, body: JSON.stringify({ error: 'Could not retrieve current security settings.' }) };
        }

        const storedHash = settingsData.pin_hash;

        // Verify the current pin provided by the user
        console.log("UPDATE-PIN: Verifying current pin...");
        const isCurrentPinValid = await bcrypt.compare(currentPin, storedHash);

        if (!isCurrentPinValid) {
            console.log("UPDATE-PIN: Current pin verification failed.");
            return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect current pin.' }) }; // Unauthorized
        }

        // Hash the new pin
        console.log("UPDATE-PIN: Hashing new pin...");
        const saltRounds = 10; // Standard number of salt rounds for bcrypt
        const newPinHash = await bcrypt.hash(newPin, saltRounds);
        console.log("UPDATE-PIN: New hash generated.");

        // Update the hash in the database
        console.log("UPDATE-PIN: Updating pin hash in database...");
        const { error: updateError } = await supabase
            .from('settings')
            .update({ pin_hash: newPinHash })
            .eq('id', 1); // Update the row with id 1

        if (updateError) {
            console.error('UPDATE-PIN: Supabase update error:', updateError);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update pin.', details: updateError.message }) };
        }

        console.log("UPDATE-PIN: Pin updated successfully.");
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Pin updated successfully.' }),
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) {
        console.error('UPDATE-PIN: Function execution error:', err);
         if (err instanceof SyntaxError) {
             return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON format in request body.' }) };
         }
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', details: err.message }) };
    }
};
