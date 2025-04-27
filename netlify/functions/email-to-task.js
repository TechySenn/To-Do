// netlify/functions/email-to-task.js
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto'); // Built-in Node.js module for verification
const querystring = require('querystring'); // For parsing form data

// Default values for new tasks created via email
const DEFAULT_PRIORITY = "New";
const DEFAULT_STATUS = "todo";

/**
 * Verifies the webhook signature from Mailgun.
 * @param {string} signingKey - Your Mailgun Webhook Signing Key.
 * @param {string} timestamp - Timestamp from the webhook payload.
 * @param {string} token - Token from the webhook payload.
 * @param {string} signature - Signature from the webhook payload.
 * @returns {boolean} - True if the signature is valid, false otherwise.
 */
function verifyMailgunSignature(signingKey, timestamp, token, signature) {
    if (!signingKey || !timestamp || !token || !signature) {
        console.error("MAILGUN-VERIFY: Missing parameters for verification.");
        return false;
    }
    try {
        const encodedToken = crypto
            .createHmac('sha256', signingKey)
            .update(timestamp + token)
            .digest('hex');

        // Use constant-time comparison to prevent timing attacks
        // Ensure buffers have the same length before comparing to avoid errors
        const sigBuffer = Buffer.from(signature, 'hex');
        const expectedSigBuffer = Buffer.from(encodedToken, 'hex');
        if (sigBuffer.length !== expectedSigBuffer.length) {
            return false;
        }
        return crypto.timingSafeEqual(expectedSigBuffer, sigBuffer);
    } catch (error) {
        console.error("MAILGUN-VERIFY: Error during signature verification:", error);
        return false;
    }
}

/**
 * Extracts a name from the 'From' field (e.g., "John Doe <john@example.com>" -> "John Doe")
 * Falls back to the full 'From' field if parsing fails.
 * @param {string} fromField - The 'From' field value.
 * @returns {string} - Extracted name or original field.
 */
function extractSenderName(fromField) {
    if (!fromField) return 'Unknown Sender';
    const match = fromField.match(/^(.*?)\s*<.*>$/); // Try to match "Name <email>" format
    return match && match[1] ? match[1].trim() : fromField.trim(); // Return name part or full field
}


exports.handler = async function(event, context) {
    // --- Check Environment Variables and Initialize Client ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const mailgunSigningKey = process.env.MAILGUN_SIGNING_KEY;

    let configError = false;
    if (!supabaseUrl || !supabaseKey) {
        console.error('EMAIL-TO-TASK: Missing Supabase credentials.');
        configError = true;
    }
    if (!mailgunSigningKey) {
        console.error('EMAIL-TO-TASK: Missing Mailgun Signing Key environment variable (MAILGUN_SIGNING_KEY).');
        configError = true;
    }
    if (configError) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    // --- End Initialization & Checks ---

    if (event.httpMethod !== 'POST') {
        console.warn('EMAIL-TO-TASK: Received non-POST request.');
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Allow': 'POST' } };
    }

    try {
        const bodyData = querystring.parse(event.body);

        // --- Verify Mailgun Signature ---
        const timestamp = bodyData['timestamp'];
        const token = bodyData['token'];
        const signature = bodyData['signature'];

        console.log("EMAIL-TO-TASK: Verifying Mailgun signature...");
        if (!verifyMailgunSignature(mailgunSigningKey, timestamp, token, signature)) {
            console.error("EMAIL-TO-TASK: Invalid Mailgun signature.");
            return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature. Request rejected.' }) };
        }
        console.log("EMAIL-TO-TASK: Mailgun signature verified successfully.");
        // --- End Signature Verification ---

        // Extract relevant email data
        const sender = bodyData['sender'] || bodyData['From'];
        const subject = bodyData['subject'] || '(No Subject)';
        // const bodyPlain = bodyData['body-plain'] || ''; // We no longer need the body

        const taskName = extractSenderName(sender);

        console.log(`EMAIL-TO-TASK: Extracted Data - Sender: ${sender}, Subject: ${subject}, Name: ${taskName}`);

        // Prepare task object for Supabase
        const newTask = {
            text: subject.trim(),
            name: taskName,
            priority: DEFAULT_PRIORITY,
            notes: '', // Set notes explicitly to empty string
            status: DEFAULT_STATUS,
        };

        // Insert into Supabase
        console.log("EMAIL-TO-TASK: Inserting new task into Supabase:", newTask);
        const { data, error: insertError } = await supabase
            .from('tasks')
            .insert([newTask])
            .select()
            .single();

        if (insertError) {
            console.error('EMAIL-TO-TASK: Supabase insert error:', insertError);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save task to database', details: insertError.message }) };
        }

        console.log("EMAIL-TO-TASK: Task created successfully from email:", data);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Task created successfully from email.' }),
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (err) {
         console.error('EMAIL-TO-TASK: Function execution error:', err);
         if (err instanceof SyntaxError) {
             return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON format in request body.' }) };
         }
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error processing email', details: err.message }) };
    }
};
