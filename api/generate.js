export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, category } = req.body;
  const rawKey = process.env.GEMINI_API_KEY;

  if (!rawKey) {
    return res.status(500).json({ error: 'Vercel-এ GEMINI_API_KEY সেট করা নেই!' });
  }

  const GEMINI_API_KEY = rawKey.trim();

  try {
    // ==========================================
    // ১. ফটো জেনারেশন
    // ==========================================
    if (category === 'photo') {
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
      return res.status(200).json({ type: 'image', result: fallbackUrl });
    }

    // ==========================================
    // ২. গুগলের নতুন Interactions API ও gemini-3.8-flash
    // ==========================================
    let userPrompt = prompt;
    if (category === 'coding') {
      userPrompt = `You are an elite developer. Provide complete, runnable single-file HTML/CSS/JavaScript code inside \`\`\`html ... \`\`\` block.\nUser Request: ${prompt}`;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/interactions?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          model: "models/gemini-3.8-flash",
          input: userPrompt,
          tools: [
            {
              type: "google_search"
            }
          ],
          generation_config: {
            max_output_tokens: 65536,
            thinking_level: "high"
          }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: `Google API Error: ${data.error.message}` });
    }

    // Interactions API-এর steps থেকে উত্তর বের করা
    let reply = "";
    if (data.steps && data.steps.length > 0) {
      const lastStep = data.steps[data.steps.length - 1];

      if (typeof lastStep === 'string') {
        reply = lastStep;
      } else if (lastStep.text) {
        reply = lastStep.text;
      } else if (lastStep.content) {
        if (typeof lastStep.content === 'string') {
          reply = lastStep.content;
        } else if (lastStep.content.parts) {
          reply = lastStep.content.parts.map(p => p.text || '').join('\n');
        }
      } else if (lastStep.parts) {
        reply = lastStep.parts.map(p => p.text || '').join('\n');
      } else {
        reply = JSON.stringify(lastStep);
      }
    } else if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      reply = data.candidates[0].content.parts[0].text;
    } else if (data.output) {
      reply = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
    } else {
      reply = "গুগল কোনো টেক্সট পাঠায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।";
    }

    return res.status(200).json({ type: 'text', result: reply });

  } catch (error) {
    return res.status(500).json({ error: "Server Error: " + error.message });
  }
}
