// netlify/functions/summarize-and-email.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const { createClient } = require('@supabase/supabase-js');

// Constants
const STICKY_NOTE_ID_LLM_PROMPT = 5;
const DEFAULT_LLM_INSTRUCTION = `You are Jay's helpful to-do list assistant.
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

    // Check for essential environment variables
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
        // We still need tasksToSummarize for the default case, but don't error if it's empty
        // if the custom prompt doesn't need it.
        if (!tasksToSummarize || !Array.isArray(tasksToSummarize)) {
            // Set to empty array if not provided, so map doesn't fail for default prompt.
            tasksToSummarize = [];
            console.warn("No tasks provided in request, or tasks is not an array. Task-dependent prompts might be affected.");
        }
    } catch (error) {
        console.error('Error parsing request body:', error);
        return { statusCode: 400, body: 'Bad Request: Invalid JSON.' };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    let llmInstruction = DEFAULT_LLM_INSTRUCTION; // Initialize with default
    let useCustomPromptAsIs = false; // Flag to indicate if Supabase prompt should be used exclusively

    try { // Outer try for the main logic
        
        console.log(`Attempting to fetch LLM prompt from Supabase with ID: ${STICKY_NOTE_ID_LLM_PROMPT}`);
        let promptNoteData = null;
        let promptNoteError = null;

        try { // Inner try specifically for Supabase operation
            const { data, error } = await supabase
                .from('sticky_note')
                .select('content')
                .eq('id', STICKY_NOTE_ID_LLM_PROMPT)
                .maybeSingle();

            promptNoteData = data;
            promptNoteError = error;

            console.log("Supabase fetch response - Data:", JSON.stringify(promptNoteData, null, 2));
            console.log("Supabase fetch response - Error:", JSON.stringify(promptNoteError, null, 2));

            if (promptNoteError) {
                console.warn(`Supabase error object during fetch (ID ${STICKY_NOTE_ID_LLM_PROMPT}):`, JSON.stringify(promptNoteError), "Using default prompt instruction strategy.");
            } else if (promptNoteData && promptNoteData.content && promptNoteData.content.trim() !== "") {
                llmInstruction = promptNoteData.content.trim();
                useCustomPromptAsIs = true; // Set flag to use this instruction as the entire prompt
                console.log("Successfully fetched LLM instruction from Supabase. Content:", llmInstruction);
            } else if (promptNoteData === null) {
                 console.warn(`LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) not found (returned null). Using default prompt instruction strategy.`);
            } else {
                console.warn(`LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) found but content is empty or missing. Using default prompt instruction strategy. Data was:`, JSON.stringify(promptNoteData));
            }
        } catch (dbCatchError) {
            console.error('Critical error during Supabase database operation:', dbCatchError, "Using default prompt instruction strategy.");
        }

        // 1. Prepare for Gemini
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest",
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            ]
        });

        let finalPrompt;

        if (useCustomPromptAsIs) {
            // A custom prompt was successfully fetched from Supabase.
            // Use ONLY this custom instruction as the entire prompt.
            finalPrompt = llmInstruction;
            console.log("Using custom instruction from Supabase as the entire prompt.");
        } else {
            // Default instruction strategy is being used (either fetch failed, note was empty).
            // In this case, append tasks and the "Concise Summary:" cue.
            if (tasksToSummarize.length === 0) {
                // Handle case where default prompt is used but no tasks are available.
                // Gemini might not give a good response to the default prompt without tasks.
                console.warn("Default summary prompt selected, but no tasks were provided to summarize.");
                // Optionally, you could send a modified prompt or return early.
                // For now, we'll let it send the default prompt which might result in a generic AI response.
                finalPrompt = `${DEFAULT_LLM_INSTRUCTION}\n\nNo tasks available to summarize at this time.`;
            } else {
                const taskDetails = tasksToSummarize.map(
                    (task, index) => `${index + 1}. ${task.text} (Status: ${task.status}, Priority: ${task.priority || 'N/A'}, Due: ${task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB') : 'N/A'})`
                ).join('\n');
                finalPrompt = `${DEFAULT_LLM_INSTRUCTION}\n\nTasks:\n${taskDetails}\n\nConcise Summary:`;
            }
            console.log("Using default summary prompt structure with task details (if available).");
        }
        
        console.log("------- FINAL PROMPT SENT TO GEMINI -------"); 
        console.log(finalPrompt);                                  
        console.log("-------------------------------------------"); 

        let llmResponseText = "Could not get a response from the AI at this time.";
        try { // Inner try for Gemini operation
            const result = await model.generateContent(finalPrompt);
            const response = result.response;
            if (response && typeof response.text === 'function') {
                llmResponseText = response.text();
            } else if (response && response.promptFeedback && response.promptFeedback.blockReason) {
                console.warn('LLM content generation blocked by API:', response.promptFeedback.blockReason, response.promptFeedback.safetyRatings);
                llmResponseText = `AI content generation was blocked. Reason: ${response.promptFeedback.blockReason}. Please check prompt/content if this persists.`;
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
            url: 'https://api.eu.mailgun.net' // EU Region endpoint
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

        try { // Inner try for Mailgun operation
            await mg.messages.create(MAILGUN_DOMAIN, emailData);
        } catch (mailgunError) {
            console.error('Full Mailgun Error Object:', JSON.stringify(mailgunError, Object.getOwnPropertyNames(mailgunError), 2));
            console.error('Error sending email with Mailgun:', mailgunError.details || mailgunError.message || mailgunError);
            return { // Email failed, but AI part might have succeeded
                statusCode: 207, // Multi-Status
                body: JSON.stringify({
                    message: 'AI response generated, but sending email failed.',
                    ai_response: llmResponseText, // Use a more generic key
                    emailError: mailgunError.message || 'An unknown error occurred with Mailgun.'
                })
            };
        }

        return { // Full success
            statusCode: 200,
            body: JSON.stringify({ message: 'AI response generated and email sent successfully!', ai_response: llmResponseText }),
        };

    } catch (error) { // Outer catch for general errors
        console.error('General error in summarize-and-email function (outer catch):', error);
        return { statusCode: 500, body: `Internal Server Error: ${error.message || 'An unknown error occurred'}` };
    }
};