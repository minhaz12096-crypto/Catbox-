export default async function handler(req, res) {
  // মেথড চেক
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
    // ১. ফটো জেনারেশন
    if (category === 'photo') {
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
      return res.status(200).json({ type: 'image', result: fallbackUrl });
    }

    // ২. কোডিং ও চ্যাট
    let userPrompt = prompt;
    if (category === 'coding') {
      userPrompt = `You are an elite developer. Provide complete, runnable single-file HTML/CSS/JavaScript code inside \`\`\`html ... \`\`\` block.\nUser Request: ${prompt}`;
    }

    // গুগলের অফিশিয়াল স্টেবল এন্ডপয়েন্ট
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: userPrompt }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: `Google API Error: ${data.error.message}` });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "গুগল কোনো টেক্সট দেয়নি।";
    return res.status(200).json({ type: 'text', result: reply });

  } catch (error) {
    return res.status(500).json({ error: "Server Error: " + error.message });
  }
}
