// netlify/functions/summarize-and-email.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const { createClient } = require('@supabase/supabase-js');

// Constants
const STICKY_NOTE_ID_LLM_PROMPT = 5;
const TASKS_PLACEHOLDER = "{TASKS_DATA}";

const DEFAULT_LLM_INSTRUCTION_PREFIX = `You are Jay's helpful to-do list assistant.
Please provide a concise summary of the following tasks.
Highlight any urgent items (High priority, New priority, or overdue).
Mention upcoming deadlines.
Keep the summary actionable and easy to read.`;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        // For scheduled functions, Netlify sends a POST request with a body like:
        // { "next_run": "2024-01-02T00:00:00.000Z" } when triggered by schedule.
        // We can allow POST for both manual and scheduled triggers.
        // If you wanted to strictly differentiate, you could check event.headers for 'x-netlify-event' === 'scheduler'
    }

    const {
        GEMINI_API_KEY,
        MAILGUN_API_KEY,
        MAILGUN_DOMAIN,
        RECIPIENT_EMAIL,
        SUPABASE_URL,
        SUPABASE_ANON_KEY // Used for reading tasks and sticky note
    } = process.env;

    if (!GEMINI_API_KEY || !MAILGUN_API_KEY || !MAILGUN_DOMAIN || !RECIPIENT_EMAIL || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('One or more critical environment variables are missing.');
        return { statusCode: 500, body: 'Server Error: Critical configuration missing.' };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    let tasksToSummarize = [];
    let sourceOfTasks = "unknown";

    // Try to get tasks from event.body (for frontend trigger)
    if (event.body) {
        try {
            const parsedBody = JSON.parse(event.body);
            if (parsedBody && parsedBody.tasks && Array.isArray(parsedBody.tasks)) {
                tasksToSummarize = parsedBody.tasks;
                sourceOfTasks = "event.body";
                console.log("Tasks received from event.body (frontend trigger).");
            } else if (parsedBody && parsedBody.next_run) {
                // This indicates a Netlify scheduled function invocation
                sourceOfTasks = "scheduled_trigger_event";
                console.log("Netlify scheduled trigger detected, will fetch tasks from DB.");
            }
             else {
                console.warn("event.body present but no valid 'tasks' array or 'next_run' field found. Will attempt DB fetch if empty.");
            }
        } catch (error) {
            console.warn('Error parsing event.body. Assuming scheduled trigger or malformed request. Will attempt DB fetch if no tasks yet. Error:', error.message);
        }
    } else {
        sourceOfTasks = "no_event_body";
        console.log("No event.body found. Assuming scheduled trigger. Will attempt DB fetch.");
    }

    // If tasks were not found in event.body (typical for scheduled run), fetch from Supabase
    if (tasksToSummarize.length === 0 && (sourceOfTasks.startsWith("scheduled_trigger") || sourceOfTasks === "no_event_body" || sourceOfTasks === "unknown")) {
        console.log("Fetching tasks from Supabase for scheduled/fallback run...");
        try {
            // Ensure your RLS policy on 'tasks' table allows 'anon' role to SELECT these tasks.
            const { data: dbTasks, error: dbError } = await supabase
                .from('tasks') // Make sure 'tasks' is your table name
                .select('text, priority, status, due_date') // Select only fields needed for the prompt
                .not('status', 'eq', 'done'); // Fetch tasks that are not in 'done' status

            if (dbError) {
                console.error('Supabase error fetching tasks:', dbError);
                // tasksToSummarize remains empty, will be handled by later logic
            } else if (dbTasks && dbTasks.length > 0) {
                tasksToSummarize = dbTasks; // This should be an array of task objects
                console.log(`Workspaceed ${tasksToSummarize.length} tasks from Supabase.`);
            } else {
                console.log("No active (non-done) tasks found in Supabase.");
            }
        } catch (fetchError) {
            console.error('Critical error fetching tasks from Supabase:', fetchError);
            // tasksToSummarize remains empty
        }
    }

    // --- LLM Prompt Fetching and Construction (remains largely the same) ---
    let fetchedLlmInstruction = null;
    try {
        console.log(`Attempting to fetch LLM prompt from Supabase with ID: ${STICKY_NOTE_ID_LLM_PROMPT}`);
        const { data: promptNoteData, error: supabaseError } = await supabase
            .from('sticky_note')
            .select('content')
            .eq('id', STICKY_NOTE_ID_LLM_PROMPT)
            .maybeSingle();

        console.log("Supabase fetch response for LLM prompt - Data:", JSON.stringify(promptNoteData, null, 2));
        console.log("Supabase fetch response for LLM prompt - Error:", JSON.stringify(supabaseError, null, 2));

        if (supabaseError) {
            console.warn(`Supabase error fetching LLM prompt (ID ${STICKY_NOTE_ID_LLM_PROMPT}):`, JSON.stringify(supabaseError), "Will use default prompt strategy.");
        } else if (promptNoteData && promptNoteData.content && promptNoteData.content.trim() !== "") {
            fetchedLlmInstruction = promptNoteData.content.trim();
            console.log("Successfully fetched LLM instruction from Supabase. Content:", fetchedLlmInstruction);
        } else if (promptNoteData === null) {
            console.warn(`LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) not found. Will use default prompt strategy.`);
        } else {
            console.warn(`LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) found but content is empty. Will use default prompt strategy.`);
        }
    } catch (dbCatchError) {
        console.error('Critical error during Supabase LLM prompt fetch:', dbCatchError.message || dbCatchError, "Will use default prompt strategy.");
    }

    // Prepare task details string (might be empty if no tasks)
    const taskDetails = tasksToSummarize.map(
        (task, index) => `${index + 1}. ${task.text} (Status: ${task.status}, Priority: ${task.priority || 'N/A'}, Due: ${task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB') : 'N/A'})`
    ).join('\n');

    let finalPrompt;
    if (fetchedLlmInstruction) {
        if (fetchedLlmInstruction.includes(TASKS_PLACEHOLDER)) {
            finalPrompt = fetchedLlmInstruction.replace(TASKS_PLACEHOLDER, taskDetails || "No tasks to list."); // Handle empty taskDetails
            console.log("Using custom instruction from Supabase and inserting task details (or 'no tasks' message) into placeholder.");
        } else {
            finalPrompt = fetchedLlmInstruction;
            console.log("Using custom instruction from Supabase as the entire prompt (no task placeholder found).");
        }
    } else {
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
};