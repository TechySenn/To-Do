// netlify/functions/summarize-and-email.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const { createClient } = require('@supabase/supabase-js'); // NEW: Import Supabase client

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
        SUPABASE_URL,         // NEW
        SUPABASE_ANON_KEY     // NEW
    } = process.env;

    // Check for essential environment variables
    if (!GEMINI_API_KEY) return { statusCode: 500, body: 'Server Error: GEMINI_API_KEY not configured.'};
    if (!MAILGUN_API_KEY) return { statusCode: 500, body: 'Server Error: MAILGUN_API_KEY not configured.'};
    if (!MAILGUN_DOMAIN) return { statusCode: 500, body: 'Server Error: MAILGUN_DOMAIN not configured.'};
    if (!RECIPIENT_EMAIL) return { statusCode: 500, body: 'Server Error: RECIPIENT_EMAIL not configured.'};
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { // NEW
        console.error('Supabase URL or Anon Key not configured.');
        return { statusCode: 500, body: 'Server Error: Supabase configuration missing.' };
    }

    let tasksToSummarize;
    try {
        const body = JSON.parse(event.body);
        tasksToSummarize = body.tasks;
        if (!tasksToSummarize || !Array.isArray(tasksToSummarize) || tasksToSummarize.length === 0) {
            return { statusCode: 400, body: 'Bad Request: No tasks provided or tasks is not an array.' };
        }
    } catch (error) {
        console.error('Error parsing request body:', error);
        return { statusCode: 400, body: 'Bad Request: Invalid JSON.' };
    }

    // NEW: Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    try {
        // --- NEW: Fetch LLM instruction from Supabase ---
        let llmInstruction = DEFAULT_LLM_INSTRUCTION;
        try {
            const { data: promptNote, error: promptError } = await supabase
                .from('sticky_note') // Assuming your table is named 'sticky_note'
                .select('content')    // Assuming the text is in a 'content' column
                .eq('id', STICKY_NOTE_ID_LLM_PROMPT)
                .single();

            if (promptError) {
                console.warn(`Supabase error fetching LLM prompt (ID ${STICKY_NOTE_ID_LLM_PROMPT}):`, promptError.message, "Using default prompt.");
            } else if (promptNote && promptNote.content && promptNote.content.trim() !== "") {
                llmInstruction = promptNote.content.trim();
                console.log("Successfully fetched LLM instruction from Supabase.");
            } else {
                console.warn(`LLM prompt note (ID ${STICKY_NOTE_ID_LLM_PROMPT}) found but content is empty or missing. Using default prompt.`);
            }
        } catch (dbError) {
            console.error('Critical error fetching LLM prompt from Supabase:', dbError, "Using default prompt.");
        }
        // --- End of Fetch LLM instruction ---

        // 1. Summarize with Gemini
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

        const taskDetails = tasksToSummarize.map(
            (task, index) => `${index + 1}. ${task.text} (Status: ${task.status}, Priority: ${task.priority || 'N/A'}, Due: ${task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB') : 'N/A'})`
        ).join('\n');

        // Use the fetched or default instruction
        const finalPrompt = `${llmInstruction}\n\nTasks:\n${taskDetails}\n\nConcise Summary:`;

        let summaryText = "Could not generate summary at this time.";
        try {
            const result = await model.generateContent(finalPrompt); // Use finalPrompt
            const response = result.response;
            if (response && typeof response.text === 'function') {
                summaryText = response.text();
            } else if (response && response.promptFeedback && response.promptFeedback.blockReason) {
                console.warn('Summary generation blocked by API:', response.promptFeedback.blockReason, response.promptFeedback.safetyRatings);
                summaryText = `Summary generation was blocked. Reason: ${response.promptFeedback.blockReason}. Please check task content/prompt if this persists.`;
            } else {
                console.warn('Unexpected Gemini response structure:', response);
                summaryText = "Received an unexpected format from the summarization service.";
            }
        } catch (geminiError) {
            console.error('Error generating summary with Gemini:', geminiError);
            summaryText = `An error occurred while trying to generate the summary: ${geminiError.message}`;
        }

        // 2. Send Email with Mailgun
        const mailgun = new Mailgun(formData);
        const mg = mailgun.client({
            username: 'api',
            key: MAILGUN_API_KEY,
            url: 'https://api.eu.mailgun.net' // EU Region endpoint
        });

        const emailSubject = `Jay's To-Do List Summary - ${new Date().toLocaleDateString('en-GB')}`;
        const emailHtmlBody = `<p>Hi Jay,</p>
                           <p>Here's a summary of your current tasks:</p>
                           <pre style="white-space: pre-wrap; font-family: sans-serif; font-size: 1rem;">${summaryText}</pre>
                           <p>Regards,<br>Your To-Do App</p>`;
        const emailTextBody = `Hi Jay,\n\nHere's a summary of your current tasks:\n\n${summaryText}\n\nRegards,\nYour To-Do App`;

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
                    message: 'Summary generated, but sending email failed.',
                    summary: summaryText,
                    emailError: mailgunError.message || 'An unknown error occurred with Mailgun.'
                })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Tasks summarized and email sent successfully!', summary: summaryText }),
        };

    } catch (error) {
        console.error('General error in summarize-and-email function:', error);
        return { statusCode: 500, body: `Internal Server Error: ${error.message || 'An unknown error occurred'}` };
    }
};