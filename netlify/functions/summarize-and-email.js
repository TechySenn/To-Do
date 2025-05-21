// netlify/functions/summarize-and-email.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const formData = require('form-data'); // Required by mailgun.js
const Mailgun = require('mailgun.js');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { GEMINI_API_KEY, MAILGUN_API_KEY, MAILGUN_DOMAIN, RECIPIENT_EMAIL } = process.env;

    if (!GEMINI_API_KEY) return { statusCode: 500, body: 'Server Error: GEMINI_API_KEY not configured.'};
    if (!MAILGUN_API_KEY) return { statusCode: 500, body: 'Server Error: MAILGUN_API_KEY not configured.'};
    if (!MAILGUN_DOMAIN) return { statusCode: 500, body: 'Server Error: MAILGUN_DOMAIN not configured.'};
    if (!RECIPIENT_EMAIL) return { statusCode: 500, body: 'Server Error: RECIPIENT_EMAIL not configured.'};

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

    try {
        // 1. Summarize with Gemini
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest", // Using the fast and cost-effective Flash model
            // Optional: Safety settings to make it less likely to block benign content
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

        const prompt = `You are Jay's helpful to-do list assistant.