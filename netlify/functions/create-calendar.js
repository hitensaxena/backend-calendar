import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { authenticateUser } from './utils/auth.js'; // Your auth utility

// Initialize Supabase client with Service Role Key for backend operations
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" }); // Or your preferred model

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authResponse = await authenticateUser(event.headers);
  if (authResponse.statusCode !== 200 || !authResponse.user) {
    return { statusCode: authResponse.statusCode, body: JSON.stringify({ error: authResponse.error }) };
  }
  const userId = authResponse.user.id;

  try {
    const userInput = JSON.parse(event.body);
    // Example: userInput = { title: "My Blog", topic: "AI in 2025", targetAudience: "Tech enthusiasts", goals: "Inform and engage", duration: "1 month" }

    const calendarPrompt = `
      You are a content strategy assistant. Based on the following user inputs:
      Topic: ${userInput.topic}
      Target Audience: ${userInput.targetAudience}
      Goals: ${userInput.goals}
      Duration: ${userInput.duration}

      Generate a content calendar for the specified duration.
      For each calendar item, provide:
      1.  "postDate": A suggested date (YYYY-MM-DD). Distribute posts reasonably over the duration.
      2.  "postTime": A suggested time (HH:MM AM/PM).
      3.  "platformSuggestion": Suggested platform (e.g., Instagram, Blog, Twitter, LinkedIn, TikTok).
      4.  "contentTypeSuggestion": Type of content (e.g., "single image post", "3-slide carousel", "short reel concept", "story idea", "blog post outline", "tweet thread idea").
      5.  "contentTheme": A brief theme or title for the post.
      6.  "detailedPromptForContentGeneration": A detailed prompt that can be fed to an AI (like yourself) later to generate the actual content (image description, text, video script outline, etc.). This prompt should be specific enough to guide the AI.
      7.  "callToAction": A suggested call to action for the post.

      Return the response as a JSON array of objects, where each object represents a calendar item.
      Example for one item:
      {
        "postDate": "2025-06-01",
        "postTime": "10:00 AM",
        "platformSuggestion": "Instagram",
        "contentTypeSuggestion": "single image post",
        "contentTheme": "The Future of AI in Daily Life",
        "detailedPromptForContentGeneration": "Generate a vibrant, optimistic image depicting diverse people seamlessly interacting with helpful AI in everyday scenarios like homes, workplaces, and public spaces. The style should be slightly futuristic but relatable. Include a friendly robot assistant helping someone with groceries.",
        "callToAction": "What AI innovation are you most excited about? Share in the comments! #FutureOfAI"
      }
    `;

    const result = await model.generateContent(calendarPrompt);
    const response = await result.response;
    const geminiOutputText = response.text();

    let calendarItemsFromGemini;
    try {
      calendarItemsFromGemini = JSON.parse(geminiOutputText);
      if (!Array.isArray(calendarItemsFromGemini)) {
        throw new Error("Gemini output is not a JSON array.");
      }
    } catch (parseError) {
      console.error("Error parsing Gemini JSON output:", parseError, "Raw output:", geminiOutputText);
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to parse content calendar from AI. Output was not valid JSON.", rawOutput: geminiOutputText }) };
    }

    // Save to Supabase
    // 1. Create the main calendar entry
    const { data: calendar, error: calendarError } = await supabase
      .from('content_calendars')
      .insert({
        user_id: userId,
        title: userInput.title || `Calendar for ${userInput.topic}`,
        user_inputs: userInput
      })
      .select()
      .single();

    if (calendarError) throw calendarError;

    // 2. Prepare and insert calendar items
    const itemsToInsert = calendarItemsFromGemini.map(item => ({
      calendar_id: calendar.id,
      user_id: userId,
      post_date: item.postDate,
      post_time: item.postTime,
      platform_suggestion: item.platformSuggestion,
      content_type_suggestion: item.contentTypeSuggestion,
      gemini_calendar_item_details: item, // Store the whole Gemini item detail
      prompt_for_content_generation: item.detailedPromptForContentGeneration,
      status: 'planned'
    }));

    const { data: savedItems, error: itemsError } = await supabase
      .from('calendar_items')
      .insert(itemsToInsert)
      .select();

    if (itemsError) throw itemsError;

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Content calendar created successfully!', calendar, items: savedItems }),
    };

  } catch (error) {
    console.error('Error creating content calendar:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create content calendar.', details: error.message }) };
  }
}