// netlify/functions/summarize-and-email.js
// This version is ONLY for the button click and expects tasks in event.body

const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
// ... (other imports: formData, Mailgun, createClient) ...
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const { createClient } = require('@supabase/supabase-js');


// Constants (STICKY_NOTE_ID_LLM_PROMPT, TASKS_PLACEHOLDER, DEFAULT_LLM_INSTRUCTION_PREFIX)
// ... (copy these from your current working version) ...
const STICKY_NOTE_ID_LLM_PROMPT = 5;
const TASKS_PLACEHOLDER = "{TASKS_DATA}";
const DEFAULT_LLM_INSTRUCTION_PREFIX = `You are Jay's helpful to-do list assistant.
Please provide a concise summary of the following tasks.
Highlight any urgent items (High priority, New priority, or overdue).
Mention upcoming deadlines.
Keep the summary actionable and easy to read.`;


exports.handler = async (event, context) => {
    console.log("summarize-and-email (manual trigger): Function invoked.");

    const { /* ... your environment variables ... */
        GEMINI_API_KEY, MAILGUN_API_KEY, MAILGUN_DOMAIN, RECIPIENT_EMAIL,
        SUPABASE_URL, SUPABASE_ANON_KEY
    } = process.env;

    if (!GEMINI_API_KEY || !MAILGUN_API_KEY /* ... etc. ... */ || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('summarize-and-email (manual trigger): Missing critical environment variables.');
        return { statusCode: 500, body: 'Server Error: Configuration missing.' };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // Still needed for sticky note ID 5
    let tasksToSummarize = [];

    if (event.body) {
        try {
            const parsedBody = JSON.parse(event.body);
            if (parsedBody && parsedBody.tasks && Array.isArray(parsedBody.tasks)) {
                tasksToSummarize = parsedBody.tasks;
                console.log("summarize-and-email (manual trigger): Tasks received from event.body.");
            } else {
                console.warn("summarize-and-email (manual trigger): event.body present but no valid 'tasks' array. Proceeding without tasks for LLM if prompt doesn't require them, or with default prompt's 'no tasks' message.");
                // tasksToSummarize remains empty
            }
        } catch (error) {
            console.error('summarize-and-email (manual trigger): Error parsing event.body:', error.message, "Proceeding as if no tasks were provided in body.");
            // tasksToSummarize remains empty
        }
    } else {
        console.error("summarize-and-email (manual trigger): No event.body found. This function expects tasks in the body for manual triggers.");
        // tasksToSummarize remains empty. The LLM prompt logic will handle this.
    }

    // --- The rest of the logic is IDENTICAL to your working summarize-and-email.js ---
    // (LLM prompt fetching from Supabase ID 5, finalPrompt construction using TASKS_PLACEHOLDER 
    // or defaulting, Gemini call, Mailgun call, returns).
    // It will use the tasksToSummarize populated (or not populated) above.
    // For brevity, ensure this part is copied correctly from your current full summarize-and-email.js script.
    // The key difference is this version DOES NOT attempt a fallback DB fetch for tasks.

    // Example continuation (ensure this matches your full file):
    let fetchedLlmInstruction = null;
    // ... (Supabase LLM prompt fetch logic for ID 5 - SAME AS BEFORE) ...
    // ... (taskDetails mapping from tasksToSummarize - SAME AS BEFORE) ...
    // ... (finalPrompt construction based on fetchedLlmInstruction and TASKS_PLACEHOLDER - SAME AS BEFORE) ...
    // ... (Gemini call - SAME AS BEFORE) ...
    // ... (Mailgun call - SAME AS BEFORE) ...
    // ... (Return statements - SAME AS BEFORE) ...
    // --- THIS IS WHERE YOUR EXISTING LLM PROMPT FETCHING, GEMINI, AND MAILGUN LOGIC WOULD GO ---
    // --- It would use the 'tasksToSummarize' populated (or not) strictly from event.body. ---
    // --- For now, I'll just simulate a return. You need to merge this with your full script. ---

    // Re-integrate your actual Gemini and Mailgun logic from the script you uploaded,
    // starting from the "// --- LLM Prompt Fetching and Construction ---" part.
    // The `tasksToSummarize` will now be correctly populated or empty based on event.body.

    // Placeholder for the rest of your full function:
    try { // Outer try from your uploaded script
        // --- Start of the rest of your function logic (from your uploaded summarize-and-email.js) ---
        // const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // Already initialized above
        // let fetchedLlmInstruction = null;  // Already initialized above
        try { 
            console.log(`summarize-and-email (manual): Attempting to fetch LLM prompt from Supabase with ID: ${STICKY_NOTE_ID_LLM_PROMPT}`);
            // ... (Supabase LLM prompt fetch logic - exactly as in your full script)
            const { data: promptNoteData, error: supabaseError } = await supabase
                .from('sticky_note')
                .select('content')
                .eq('id', STICKY_NOTE_ID_LLM_PROMPT)
                .maybeSingle();
            // ... (console logs for data/error)
            if (supabaseError) { /* ... */ } else if (promptNoteData && promptNoteData.content && promptNoteData.content.trim() !== "") { fetchedLlmInstruction = promptNoteData.content.trim(); /* ... */ } else if (promptNoteData === null) { /* ... */ } else { /* ... */ }
        } catch (dbCatchError) { /* ... */ }

        const taskDetails = tasksToSummarize.map(
            (task, index) => `${index + 1}. ${task.text} (Status: ${task.status}, Priority: ${task.priority || 'N/A'}, Due: ${task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB') : 'N/A'})`
        ).join('\n');

        let finalPrompt;
        if (fetchedLlmInstruction) {
            if (fetchedLlmInstruction.includes(TASKS_PLACEHOLDER)) {
                finalPrompt = fetchedLlmInstruction.replace(TASKS_PLACEHOLDER, taskDetails || "No tasks provided by trigger.");
                // ...
            } else {
                finalPrompt = fetchedLlmInstruction;
                // ...
            }
        } else {
            // ... (default prompt logic using DEFAULT_LLM_INSTRUCTION_PREFIX)
            if (tasksToSummarize.length === 0) {
                finalPrompt = `${DEFAULT_LLM_INSTRUCTION_PREFIX}\n\nNo tasks were provided by the trigger.`;
            } else {
                finalPrompt = `<span class="math-inline">\{DEFAULT\_LLM\_INSTRUCTION\_PREFIX\}\\n\\nTasks\:\\n</span>{taskDetails}\n\nConcise Summary:`;
            }
        }

        // ... (Gemini and Mailgun logic from your full script) ...
        console.log("summarize-and-email (manual): ------- FINAL PROMPT SENT TO GEMINI -------"); 
        console.log(finalPrompt);                                  
        console.log("summarize-and-email (manual): -------------------------------------------"); 

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", safetySettings: [ /* your safety settings */ ] });
        let llmResponseText = "summarize-and-email (manual): Could not get a response from the AI.";
        // ... (Gemini try/catch logic)
        try { const result = await model.generateContent(finalPrompt); /* ... */ if (result.response && typeof result.response.text === 'function') llmResponseText = result.response.text(); /* ... else conditions ... */ } catch (geminiError) { /* ... */ }

        const mailgun = new Mailgun(formData);
        const mg = mailgun.client({ username: 'api', key: MAILGUN_API_KEY, url: 'https://api.eu.mailgun.net'});
        // ... (emailData construction, mg.messages.create, and return statements)
        const emailSubject = `Jay's To-Do List Assistant - ${new Date().toLocaleDateString('en-GB')}`;
        const emailHtmlBody = `<p>Hi Jay,</p><p>Here's the response based on your instruction:</p><pre>${llmResponseText}</pre><p>Regards,<br>Your To-Do App Assistant</p>`;
        const emailTextBody = `Hi Jay,\n\nHere's the response based on your instruction:\n\n${llmResponseText}\n\nRegards,\nYour To-Do App Assistant`;
        const emailData = { from: `Jay's To Do List Bot <bot@${MAILGUN_DOMAIN}>`, to: [RECIPIENT_EMAIL], subject: emailSubject, text: emailTextBody, html: emailHtmlBody };
        try { await mg.messages.create(MAILGUN_DOMAIN, emailData); } catch (mailgunError) { /* ... */ return { statusCode: 207, body: JSON.stringify({ message: 'AI response generated, but email failed.', ai_response: llmResponseText, emailError: mailgunError.message}) }; }
        return { statusCode: 200, body: JSON.stringify({ message: 'AI response generated and email sent successfully!', ai_response: llmResponseText }) };

    } catch (error) { // Outer catch
        console.error('summarize-and-email (manual trigger): General error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: `Internal Server Error: ${error.message}` }) };
    }
    // --- End of the rest of your function logic ---
};