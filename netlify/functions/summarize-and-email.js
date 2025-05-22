// netlify/functions/summarize-and-email.js
// ... (imports and constants remain the same) ...

exports.handler = async (event, context) => { // Add context here
    // ... (env var checks remain the same) ...

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
                console.warn("event.body present for a non-scheduled call, but no valid 'tasks' array found. Will attempt DB fetch if empty.");
            }
        } catch (error) {
            console.warn('Error parsing event.body for non-scheduled call. Will attempt DB fetch if no tasks yet. Error:', error.message);
        }
    } else if (!isScheduledInvocation && !event.body) {
        // Manual trigger but no body - could be a GET or misconfigured POST
        console.warn("Non-scheduled trigger with no event.body. This might be unexpected for a POST request.");
    }


    // If it's a scheduled invocation OR if it was a manual trigger that didn't provide tasks in the body, fetch from Supabase.
    if (isScheduledInvocation || tasksToSummarize.length === 0) {
        if (isScheduledInvocation) {
            console.log("Fetching tasks from Supabase for scheduled run...");
        } else {
            console.log("No tasks in event.body from manual trigger, attempting to fetch from Supabase as a fallback...");
        }
        try {
            // ... (Supabase task fetching logic - ensure it's robust, as previously discussed)
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

    // ... (rest of the script: LLM prompt fetching, finalPrompt construction, Gemini, Mailgun) ...
    // Ensure the rest of your script (LLM prompt fetching, Gemini call, Mailgun call)
    // is placed correctly after this tasksToSummarize logic.
    // For brevity, I'm not repeating the entire LLM and Mailgun sections here,
    // but they would follow, using the `tasksToSummarize` array.

    // Example of how the rest of the script would continue:
    // let fetchedLlmInstruction = null;
    // try { /* ... fetch LLM prompt from sticky_note ... */ } catch {}
    // const taskDetails = tasksToSummarize.map(...).join('\n');
    // let finalPrompt;
    // if (fetchedLlmInstruction) { /* ... construct finalPrompt with placeholder or as is ... */ }
    // else { /* ... construct finalPrompt with DEFAULT_LLM_INSTRUCTION_PREFIX and taskDetails ... */ }
    // console.log("------- FINAL PROMPT SENT TO GEMINI -------"); etc.
    // ... then Gemini call, Mailgun call, and return statements ...

    // THIS IS A PLACEHOLDER - ensure your actual Gemini/Mailgun logic and returns are here
    if (isScheduledInvocation && tasksToSummarize.length === 0) {
         console.log("Scheduled run: No tasks found to process after DB check. Email might be about no tasks.");
    }
    // The actual Gemini, Mailgun calls, and final return statements need to be here,
    // similar to the last complete script you had.
    // For this example, I'll just return a success to avoid breaking the structure.
    // You need to integrate this task fetching logic into your existing complete summarize-and-email.js.
    // This is just showing the task fetching part.

    // --- THIS IS WHERE YOUR EXISTING LLM PROMPT FETCHING, GEMINI, AND MAILGUN LOGIC WOULD GO ---
    // --- It would use the 'tasksToSummarize' populated above. ---
    // --- For now, I'll just simulate a return. You need to merge this with your full script. ---
    // --- The script you uploaded is a good base to merge this into. ---

    // For testing this specific part, you could temporarily return tasksToSummarize
    // return { statusCode: 200, body: JSON.stringify({ tasksFound: tasksToSummarize.length, source: isScheduledInvocation ? "schedule" : "manual_with_body_or_fallback_db_fetch" }) };

    // IMPORTANT: The following is a very simplified return. You need to integrate the above logic
    // into your full `summarize-and-email.js` that includes the Gemini and Mailgun calls.
    // The goal here is to correctly populate `tasksToSummarize`.
    // The rest of your function (Gemini call, Mailgun call) should then use this `tasksToSummarize`.

    // Re-integrate your actual Gemini and Mailgun logic from the script you uploaded,
    // starting from the "// --- LLM Prompt Fetching and Construction ---" part.
    // The `tasksToSummarize` will now be correctly populated.

    // Placeholder for the rest of your full function:
    // --- Start of the rest of your function logic (from your uploaded summarize-and-email.js) ---
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // Already initialized above
        let fetchedLlmInstruction = null; 
        try { 
            console.log(`Attempting to fetch LLM prompt from Supabase with ID: ${STICKY_NOTE_ID_LLM_PROMPT}`);
            try { 
                const { data: promptNoteData, error: supabaseError } = await supabase 
                    .from('sticky_note')
                    .select('content')
                    .eq('id', STICKY_NOTE_ID_LLM_PROMPT)
                    .maybeSingle();

                console.log("Supabase fetch response - Data:", JSON.stringify(promptNoteData, null, 2));
                console.log("Supabase fetch response - Error:", JSON.stringify(supabaseError, null, 2)); 

                if (supabaseError) { 
                    console.warn(`Supabase error object during fetch (ID ${STICKY_NOTE_ID_LLM_PROMPT}):`, JSON.stringify(supabaseError), "Will use default prompt strategy.");
                } else if (promptNoteData && promptNoteData.content && promptNoteData.content.trim() !== "") {
                    fetchedLlmInstruction = promptNoteData.content.trim();
                    console.log("Successfully fetched LLM instruction from Supabase. Content:", fetchedLlmInstruction);
                } else if (promptNoteData === null) {
                     console.warn(`LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) not found (Supabase returned null data). Will use default prompt strategy.`);
                } else { 
                    console.warn(`LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) found but content is empty or missing. Will use default prompt strategy. Data was:`, JSON.stringify(promptNoteData));
                }
            } catch (dbCatchError) { 
                console.error('Critical error during Supabase database operation:', dbCatchError.message || dbCatchError, "Will use default prompt strategy.");
            }

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

        } catch (error) { // This is the outer catch from your uploaded script
            console.error('General error in summarize-and-email function (outer catch):', error);
            return { statusCode: 500, body: `Internal Server Error: ${error.message || 'An unknown error occurred'}` };
        }
    // --- End of the rest of your function logic ---
};