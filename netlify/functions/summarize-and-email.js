// netlify/functions/summarize-and-email.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const { createClient } = require('@supabase/supabase-js'); // IMPORT createClient HERE

// Constants
const STICKY_NOTE_ID_LLM_PROMPT = 5;
const TASKS_PLACEHOLDER = "{TASKS_DATA}";

const DEFAULT_LLM_INSTRUCTION_PREFIX = `You are Jay's helpful to-do list assistant.
Please provide a concise summary of the following tasks.
Highlight any urgent items (High priority, New priority, or overdue).
Mention upcoming deadlines.
Keep the summary actionable and easy to read.`;

exports.handler = async (event, context) => { // Added context for x-netlify-event header
    const {
        GEMINI_API_KEY,
        MAILGUN_API_KEY,
        MAILGUN_DOMAIN,
        RECIPIENT_EMAIL,
        SUPABASE_URL,
        SUPABASE_ANON_KEY // Used for reading sticky note and tasks
    } = process.env;

    if (!GEMINI_API_KEY || !MAILGUN_API_KEY || !MAILGUN_DOMAIN || !RECIPIENT_EMAIL || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('One or more critical environment variables are missing.');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server Error: Critical configuration missing.' }) };
    }

    // Initialize Supabase client ONCE
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let tasksToSummarize = [];
    let isScheduledInvocation = false;

    // Check for Netlify's scheduler event header
    if (event.headers && event.headers['x-netlify-event'] === 'scheduler') {
        isScheduledInvocation = true;
        console.log("Netlify scheduled trigger detected via x-netlify-event header.");
    }

    // Try to get tasks from event.body (for frontend/manual trigger)
    if (!isScheduledInvocation && event.body) {
        try {
            const parsedBody = JSON.parse(event.body);
            if (parsedBody && parsedBody.tasks && Array.isArray(parsedBody.tasks)) {
                tasksToSummarize = parsedBody.tasks;
                console.log("Tasks received from event.body (frontend trigger).");
            } else {
                console.warn("event.body present for a non-scheduled call, but no valid 'tasks' array found. Will attempt DB fetch if tasks are empty.");
            }
        } catch (error) {
            console.warn('Error parsing event.body for non-scheduled call. Will attempt DB fetch if tasks are empty. Error:', error.message);
        }
    } else if (!isScheduledInvocation && !event.body) {
        console.warn("Non-scheduled trigger with no event.body. Will attempt DB fetch if tasks are empty.");
    }

    // If it's a scheduled invocation OR if tasksToSummarize is still empty from a manual trigger, fetch from Supabase.
    if (isScheduledInvocation || tasksToSummarize.length === 0) {
        if (isScheduledInvocation) {
            console.log("Fetching tasks from Supabase for scheduled run...");
        } else { // This means it was a manual trigger but tasksToSummarize was empty
            console.log("No tasks in event.body from manual trigger, or parsing failed; attempting to fetch from Supabase as a fallback...");
        }
        try {
            const { data: dbTasks, error: dbError } = await supabase
                .from('tasks')
                .select('text, priority, status, due_date')
                .not('status', 'eq', 'done');

            if (dbError) {
                console.error('Supabase error fetching tasks:', dbError);
            } else if (dbTasks && dbTasks.length > 0) {
                tasksToSummarize = dbTasks;
                console.log(`Workspaceed ${tasksToSummarize.length} tasks from Supabase.`);
            } else {
                console.log("No active (non-done) tasks found in Supabase for this run.");
            }
        } catch (fetchError) {
            console.error('Critical error fetching tasks from Supabase:', fetchError);
        }
    }

    // --- LLM Prompt Fetching ---
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

    // Prepare task details string
    const taskDetails = tasksToSummarize.map(
        (task, index) => `${index + 1}. ${task.text} (Status: ${task.status}, Priority: ${task.priority || 'N/A'}, Due: ${task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB') : 'N/A'})`
    ).join('\n');

    let finalPrompt;
    if (fetchedLlmInstruction) {
        if (fetchedLlmInstruction.includes(TASKS_PLACEHOLDER)) {
            finalPrompt = fetchedLlmInstruction.replace(TASKS_PLACEHOLDER, taskDetails || "No tasks to list.");
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
        safetySettings: [ /* your safety settings */ ]
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