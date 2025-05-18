import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { authenticateUser } from './utils/auth.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

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
    const { calendar_item_id } = JSON.parse(event.body);
    if (!calendar_item_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'calendar_item_id is required.' }) };
    }

    // 1. Fetch the calendar item and its generation prompt
    const { data: calendarItem, error: fetchError } = await supabase
      .from('calendar_items')
      .select('id, prompt_for_content_generation, content_type_suggestion')
      .eq('id', calendar_item_id)
      .eq('user_id', userId) // Ensure user owns this item
      .single();

    if (fetchError || !calendarItem) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Calendar item not found or access denied.' }) };
    }

    if (!calendarItem.prompt_for_content_generation) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No content generation prompt found for this item.' }) };
    }

    // 2. Call Gemini API with the specific prompt
    const contentGenerationPrompt = calendarItem.prompt_for_content_generation;
    const result = await model.generateContent(contentGenerationPrompt);
    const response = await result.response;
    const generatedAssetData = response.text(); // This is the generated text, image description, or script

    // 3. Determine asset type (this might need refinement based on contentTypeSuggestion)
    let assetType = "generated_text";
    const contentType = calendarItem.content_type_suggestion.toLowerCase();
    if (contentType.includes("image")) {
      assetType = "image_description_or_prompt"; // Gemini might provide a better prompt for a dedicated image AI
    } else if (contentType.includes("video") || contentType.includes("reel") || contentType.includes("story")) {
      assetType = "video_script_or_concept";
    }

    // 4. Save the generated asset to Supabase
    const { data: savedAsset, error: assetError } = await supabase
      .from('generated_content_assets')
      .insert({
        calendar_item_id: calendarItem.id,
        user_id: userId,
        asset_type: assetType,
        asset_data: generatedAssetData,
        prompt_used: contentGenerationPrompt
      })
      .select()
      .single();

    if (assetError) throw assetError;

    // 5. Update status of the calendar_item
    await supabase
      .from('calendar_items')
      .update({ status: 'content_generated' })
      .eq('id', calendarItem.id);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Content item generated successfully!', asset: savedAsset }),
    };

  } catch (error) {
    console.error('Error creating content item:', error);
    // Update status to 'failed' if an error occurs during generation
    const body = JSON.parse(event.body);
    if (body.calendar_item_id) {
        await supabase
            .from('calendar_items')
            .update({ status: 'failed' })
            .eq('id', body.calendar_item_id)
            .eq('user_id', userId); // ensure user match
    }
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create content item.', details: error.message }) };
  }
}