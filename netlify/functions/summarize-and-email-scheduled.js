// netlify/functions/summarize-and-email-scheduled.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const { createClient } = require('@supabase/supabase-js');

// Constants (STICKY_NOTE_ID_LLM_PROMPT, TASKS_PLACEHOLDER, DEFAULT_LLM_INSTRUCTION_PREFIX)
// ... (copy these from your working summarize-and-email.js) ...
const STICKY_NOTE_ID_LLM_PROMPT = 5;
const TASKS_PLACEHOLDER = "{TASKS_DATA}";
const DEFAULT_LLM_INSTRUCTION_PREFIX = `You are Jay's helpful to-do list assistant.
Please provide a concise summary of the following tasks.
Highlight any urgent items (High priority, New priority, or overdue).
Mention upcoming deadlines.
Keep the summary actionable and easy to read.`;


exports.handler = async (event, context) => {
    console.log("summarize-and-email-scheduled: Function invoked by schedule.");

    const { /* ... your environment variables ... */
        GEMINI_API_KEY, MAILGUN_API_KEY, MAILGUN_DOMAIN, RECIPIENT_EMAIL,
        SUPABASE_URL, SUPABASE_ANON_KEY
    } = process.env;

    if (!GEMINI_API_KEY || !MAILGUN_API_KEY /* ... etc. ... */ || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('summarize-and-email-scheduled: Missing critical environment variables.');
        return { statusCode: 500, body: 'Server Error: Configuration missing.' };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    let tasksToSummarize = [];

    // This function ALWAYS fetches tasks from Supabase
    console.log("summarize-and-email-scheduled: Fetching tasks from Supabase...");
    try {
        const { data: dbTasks, error: dbError } = await supabase
            .from('tasks')
            .select('text, priority, status, due_date')
            .not('status', 'eq', 'done');

        if (dbError) {
            console.error('summarize-and-email-scheduled: Supabase error fetching tasks:', dbError);
        } else if (dbTasks && dbTasks.length > 0) {
            tasksToSummarize = dbTasks;
            console.log(`summarize-and-email-scheduled: Fetched ${tasksToSummarize.length} tasks.`);
        } else {
            console.log("summarize-and-email-scheduled: No active tasks found in Supabase.");
        }
    } catch (fetchError) {
        console.error('summarize-and-email-scheduled: Critical error fetching tasks:', fetchError);
    }

    // --- The rest of the logic is IDENTICAL to your working summarize-and-email.js ---
    // (LLM prompt fetching, finalPrompt construction, Gemini call, Mailgun call, returns)
    // Ensure you copy that entire remaining logic here.
    // For example:
    let fetchedLlmInstruction = null;
    try {
        console.log(`summarize-and-email-scheduled: Attempting to fetch LLM prompt from Supabase with ID: ${STICKY_NOTE_ID_LLM_PROMPT}`);
        // ... (rest of your Supabase LLM prompt fetch logic) ...
        const { data: promptNoteData, error: supabaseError } = await supabase
            .from('sticky_note')
            .select('content')
            .eq('id', STICKY_NOTE_ID_LLM_PROMPT)
            .maybeSingle();

        console.log("summarize-and-email-scheduled: Supabase fetch response for LLM prompt - Data:", JSON.stringify(promptNoteData, null, 2));
        console.log("summarize-and-email-scheduled: Supabase fetch response for LLM prompt - Error:", JSON.stringify(supabaseError, null, 2));

        if (supabaseError) {
            console.warn(`summarize-and-email-scheduled: Supabase error fetching LLM prompt (ID ${STICKY_NOTE_ID_LLM_PROMPT}):`, JSON.stringify(supabaseError), "Will use default prompt strategy.");
        } else if (promptNoteData && promptNoteData.content && promptNoteData.content.trim() !== "") {
            fetchedLlmInstruction = promptNoteData.content.trim();
            console.log("summarize-and-email-scheduled: Successfully fetched LLM instruction from Supabase. Content:", fetchedLlmInstruction);
        } else if (promptNoteData === null) {
            console.warn(`summarize-and-email-scheduled: LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) not found. Will use default prompt strategy.`);
        } else {
            console.warn(`summarize-and-email-scheduled: LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) found but content is empty. Will use default prompt strategy.`);
        }
    } catch (dbCatchError) {
        console.error('summarize-and-email-scheduled: Critical error during Supabase LLM prompt fetch:', dbCatchError.message || dbCatchError, "Will use default prompt strategy.");
    }

    const taskDetails = tasksToSummarize.map(
        (task, index) => `${index + 1}. ${task.text} (Status: ${task.status}, Priority: ${task.priority || 'N/A'}, Due: ${task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB') : 'N/A'})`
    ).join('\n');

    let finalPrompt;
    if (fetchedLlmInstruction) {
        if (fetchedLlmInstruction.includes(TASKS_PLACEHOLDER)) {
            finalPrompt = fetchedLlmInstruction.replace(TASKS_PLACEHOLDER, taskDetails || "No tasks to list.");
            console.log("summarize-and-email-scheduled: Using custom instruction and inserting task details.");
        } else {
            finalPrompt = fetchedLlmInstruction;
            console.log("summarize-and-email-scheduled: Using custom instruction as entire prompt.");
        }
    } else {
        console.log("summarize-and-email-scheduled: Using default summary prompt strategy.");
        if (tasksToSummarize.length === 0) {
            finalPrompt = `${DEFAULT_LLM_INSTRUCTION_PREFIX}\n\nNo tasks available to summarize at this time.`;
        } else {
            finalPrompt = `<span class="math-inline">\{DEFAULT\_LLM\_INSTRUCTION\_PREFIX\}\\n\\nTasks\:\\n</span>{taskDetails}\n\nConcise Summary:`;
        }
    }

    console.log("summarize-and-email-scheduled: ------- FINAL PROMPT SENT TO GEMINI -------"); 
    console.log(finalPrompt);                                  
    console.log("summarize-and-email-scheduled: -------------------------------------------"); 

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", safetySettings: [ /* your safety settings */ ] });

    let llmResponseText = "summarize-and-email-scheduled: Could not get a response from the AI.";
    try {
        const result = await model.generateContent(finalPrompt);
        const response = result.response;
        if (response && typeof response.text === 'function') {
            llmResponseText = response.text();
        } else if (response && response.promptFeedback && response.promptFeedback.blockReason) {
            console.warn('summarize-and-email-scheduled: LLM content generation blocked:', response.promptFeedback.blockReason);
            llmResponseText = `summarize-and-email-scheduled: AI content generation was blocked. Reason: ${response.promptFeedback.blockReason}.`;
        } else {
            console.warn('summarize-and-email-scheduled: Unexpected Gemini response structure:', response);
            llmResponseText = "summarize-and-email-scheduled: Received an unexpected format from AI.";
        }
    } catch (geminiError) {
        console.error('summarize-and-email-scheduled: Error during AI content generation:', geminiError);
        llmResponseText = `summarize-and-email-scheduled: AI error: ${geminiError.message}`;
    }

    const mailgun = new Mailgun(formData);
    const mg = mailgun.client({ username: 'api', key: MAILGUN_API_KEY, url: 'https://api.eu.mailgun.net' });
    // ... (emailData construction, mg.messages.create, and return statements as in your working version) ...
    const emailSubject = `Jay's To-Do List Assistant (Scheduled) - ${new Date().toLocaleDateString('en-GB')}`;
    // ... (construct emailHtmlBody and emailTextBody using llmResponseText)
    // ... (construct emailData)
    // ... (try/catch for Mailgun send)
    // ... (return success or 207 or error)
    // For brevity, ensure this part is copied correctly from your fully working summarize-and-email.js
    const emailHtmlBody = `<p>Hi Jay,</p><p>(Scheduled Report)</p><pre style="white-space: pre-wrap;">${llmResponseText}</pre><p>Regards,<br>Your To-Do App Assistant</p>`;
    const emailTextBody = `Hi Jay,\n\n(Scheduled Report)\n${llmResponseText}\n\nRegards,\nYour To-Do App Assistant`;
    const emailData = { from: `Jay's To Do List Bot <bot@${MAILGUN_DOMAIN}>`, to: [RECIPIENT_EMAIL], subject: emailSubject, text: emailTextBody, html: emailHtmlBody };
    try { await mg.messages.create(MAILGUN_DOMAIN, emailData); } catch (mailgunError) { /* ... */ return { statusCode: 207, body: JSON.stringify({ message: 'Scheduled: AI response generated, but email failed.', ai_response: llmResponseText, emailError: mailgunError.message}) }; }
    return { statusCode: 200, body: JSON.stringify({ message: 'Scheduled: AI response generated and email sent!', ai_response: llmResponseText }) };
};