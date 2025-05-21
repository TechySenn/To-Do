// netlify/functions/summarize-and-email.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const { createClient } = require('@supabase/supabase-js');

// Constants
const STICKY_NOTE_ID_LLM_PROMPT = 5;
const TASKS_PLACEHOLDER = "{TASKS_DATA}"; // Define a placeholder

// Default instruction now implicitly expects tasks to be appended if it's used.
const DEFAULT_LLM_INSTRUCTION_PREFIX = `You are Jay's helpful to-do list assistant.
Please provide a concise summary of the following tasks.
Highlight any urgent items (High priority, New priority, or overdue).
Mention upcoming deadlines.
Keep the summary actionable and easy to read.`;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const {
        GEMINI_API_KEY,
        MAILGUN_API_KEY,
        MAILGUN_DOMAIN,
        RECIPIENT_EMAIL,
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    } = process.env;

    // Check for essential environment variables (ensure these are complete)
    if (!GEMINI_API_KEY) return { statusCode: 500, body: 'Server Error: GEMINI_API_KEY not configured.'};
    if (!MAILGUN_API_KEY) return { statusCode: 500, body: 'Server Error: MAILGUN_API_KEY not configured.'};
    if (!MAILGUN_DOMAIN) return { statusCode: 500, body: 'Server Error: MAILGUN_DOMAIN not configured.'};
    if (!RECIPIENT_EMAIL) return { statusCode: 500, body: 'Server Error: RECIPIENT_EMAIL not configured.'};
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('Supabase URL or Anon Key not configured.');
        return { statusCode: 500, body: 'Server Error: Supabase configuration missing.' };
    }

    let tasksToSummarize;
    try {
        const body = JSON.parse(event.body);
        tasksToSummarize = body.tasks;
        if (!tasksToSummarize || !Array.isArray(tasksToSummarize)) {
            tasksToSummarize = []; // Default to empty array if tasks are missing/invalid
            console.warn("Tasks not provided or in incorrect format in the request body.");
        }
    } catch (error) {
        console.error('Error parsing request body:', error);
        return { statusCode: 400, body: 'Bad Request: Invalid JSON.' };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    let fetchedLlmInstruction = null; // Store the fetched instruction separately

    try { // Outer try for the main logic
        
        console.log(`Attempting to fetch LLM prompt from Supabase with ID: ${STICKY_NOTE_ID_LLM_PROMPT}`);
        try { // Inner try specifically for Supabase operation
            const { data: promptNote, error: promptError } = await supabase
                .from('sticky_note')
                .select('content')
                .eq('id', STICKY_NOTE_ID_LLM_PROMPT)
                .maybeSingle();

            console.log("Supabase fetch response - Data:", JSON.stringify(promptNote, null, 2));
            console.log("Supabase fetch response - Error:", JSON.stringify(promptNoteError, null, 2));

            if (promptError) {
                console.warn(`Supabase error object during fetch (ID ${STICKY_NOTE_ID_LLM_PROMPT}):`, JSON.stringify(promptError), "Will use default summary strategy if applicable.");
            } else if (promptNote && promptNote.content && promptNote.content.trim() !== "") {
                fetchedLlmInstruction = promptNote.content.trim();
                console.log("Successfully fetched LLM instruction from Supabase. Content:", fetchedLlmInstruction);
            } else if (promptNote === null) {
                 console.warn(`LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) not found (returned null). Will use default summary strategy if applicable.`);
            } else {
                console.warn(`LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) found but content is empty or missing. Will use default summary strategy if applicable. Data was:`, JSON.stringify(promptNote));
            }
        } catch (dbCatchError) {
            console.error('Critical error during Supabase database operation:', dbCatchError, "Will use default summary strategy if applicable.");
        }

        // Prepare task details string (always needed if default prompt is used or if custom prompt uses placeholder)
        const taskDetails = tasksToSummarize.map(
            (task, index) => `${index + 1}. ${task.text} (Status: ${task.status}, Priority: ${task.priority || 'N/A'}, Due: ${task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB') : 'N/A'})`
        ).join('\n');

        let finalPrompt;

        if (fetchedLlmInstruction) {
            // A custom instruction was successfully fetched from Supabase.
            if (fetchedLlmInstruction.includes(TASKS_PLACEHOLDER)) {
                // If the custom instruction includes the placeholder, replace it with taskDetails.
                finalPrompt = fetchedLlmInstruction.replace(TASKS_PLACEHOLDER, taskDetails);
                console.log("Using custom instruction from Supabase and inserting task details into placeholder.");
            } else {
                // If no placeholder, use the custom instruction as is (e.g., "What's the time?").
                finalPrompt = fetchedLlmInstruction;
                console.log("Using custom instruction from Supabase as the entire prompt (no task placeholder found).");
            }
        } else {
            // Default instruction strategy (fetch failed or note was empty).
            console.log("Using default summary prompt strategy.");
            if (tasksToSummarize.length === 0) {
                finalPrompt = `${DEFAULT_LLM_INSTRUCTION_PREFIX}\n\nNo tasks available to summarize at this time.`;
            } else {
                finalPrompt = `${DEFAULT_LLM_INSTRUCTION_PREFIX}\n\nTasks:\n${taskDetails}\n\nConcise Summary:`;
            }
        }
        
        console.log("------- FINAL PROMPT SENT TO GEMINI -------"); 
        console.log(finalPrompt);                                  
        console.log("-------------------------------------------"); 

        // 1. Generate content with Gemini
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest",
            safetySettings: [ /* ... your safety settings ... */ ]
        });

        let llmResponseText = "Could not get a response from the AI at this time.";
        try {
            const result = await model.generateContent(finalPrompt);
            const response = result.response;
            if (response && typeof response.text === 'function') {
                llmResponseText = response.text();
            } else if (response && response.promptFeedback && response.promptFeedback.blockReason) {
                console.warn('LLM content generation blocked by API:', response.promptFeedback.blockReason, response.promptFeedback.safetyRatings);
                llmResponseText = `AI content generation was blocked. Reason: ${response.promptFeedback.blockReason}.`;
            } else {
                console.warn('Unexpected Gemini response structure:', response);
                llmResponseText = "Received an unexpected format from the AI service.";
            }
        } catch (geminiError) {
            console.error('Error during AI content generation (Gemini):', geminiError);
            llmResponseText = `An error occurred while trying to get a response from the AI: ${geminiError.message}`;
        }

        // 2. Send Email with Mailgun
        // ... (Mailgun client setup and email sending logic remains the same as the last good version)
        const mailgun = new Mailgun(formData);
        const mg = mailgun.client({
            username: 'api',
            key: MAILGUN_API_KEY,
            url: 'https://api.eu.mailgun.net'
        });

        const emailSubject = `Jay's To-Do List Assistant - ${new Date().toLocaleDateString('en-GB')}`;
        const emailHtmlBody = `<p>Hi Jay,</p>
                           <p>Here's the response based on your instruction:</p>
                           <pre style="white-space: pre-wrap; font-family: sans-serif; font-size: 1rem;">${llmResponseText}</pre>
                           <p>Regards,<br>Your To-Do App Assistant</p>`;
        const emailTextBody = `Hi Jay,\n\nHere's the response based on your instruction:\n\n${llmResponseText}\n\nRegards,\nYour To-Do App Assistant`;

        const emailData = {
            from: `Jay's To Do List Bot <bot@${MAILGUN_DOMAIN}>`,
            to: [RECIPIENT_EMAIL],
            subject: emailSubject,
            text: emailTextBody,
            html: emailHtmlBody
        };

        try {
            await mg.messages.create(MAILGUN_DOMAIN, emailData);
        } catch (mailgunError) {
            console.error('Full Mailgun Error Object:', JSON.stringify(mailgunError, Object.getOwnPropertyNames(mailgunError), 2));
            console.error('Error sending email with Mailgun:', mailgunError.details || mailgunError.message || mailgunError);
            return {
                statusCode: 207,
                body: JSON.stringify({
                    message: 'AI response generated, but sending email failed.',
                    ai_response: llmResponseText,
                    emailError: mailgunError.message || 'An unknown error occurred with Mailgun.'
                })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'AI response generated and email sent successfully!', ai_response: llmResponseText }),
        };

    } catch (error) {
        console.error('General error in summarize-and-email function (outer catch):', error);
        return { statusCode: 500, body: `Internal Server Error: ${error.message || 'An unknown error occurred'}` };
    }
};