export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, category } = req.body;
  const rawKey = process.env.GEMINI_API_KEY;

  if (!rawKey) {
    return res.status(500).json({ 
      error: 'Vercel-এ GEMINI_API_KEY সেট করা নেই!' 
    });
  }

  const GEMINI_API_KEY = rawKey.trim();

  try {
    // ==========================================
    // ১. ফটো জেনারেশন
    // ==========================================
    if (category === 'photo') {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-goog-api-key': GEMINI_API_KEY
            },
            body: JSON.stringify({
              instances: [{ prompt: prompt }],
              parameters: { sampleCount: 1, aspectRatio: "1:1", outputMimeType: "image/jpeg" }
            })
          }
        );

        const data = await response.json();
        if (data.predictions?.[0]?.bytesBase64Encoded) {
          return res.status(200).json({ 
            type: 'image', 
            result: `data:image/jpeg;base64,${data.predictions[0].bytesBase64Encoded}` 
          });
        }
      } catch (err) {
        console.log("Imagen fallback triggered");
      }

      // ফ্রি কি-তে কোটা না থাকলে আল্ট্রা ফাস্ট ব্যাকআপ ইঞ্জিন
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
      return res.status(200).json({ type: 'image', result: fallbackUrl });
    }

    // ==========================================
    // ২. AI Studio-র নতুন ফরম্যাট অনুযায়ী কোডিং ও চ্যাট
    // ==========================================
    let userPrompt = prompt;
    if (category === 'coding') {
      userPrompt = `You are an elite developer. Provide complete, runnable single-file HTML/CSS/JavaScript code inside \`\`\`html ... \`\`\` block.\nUser Request: ${prompt}`;
    }

    // আপনার AI Studio থেকে পাওয়া এন্ডপয়েন্ট ও প্যারামিটার
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/interactions?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          model: "models/gemini-2.5-flash",
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

    // কোনো এরর আসলে তা সুন্দরভাবে দেখানো
    if (data.error) {
      return res.status(400).json({ 
        error: `Google API Error: ${data.error.message}` 
      });
    }

    // নতুন Interactions রেসপন্স থেকে টেক্সট বের করা
    let reply = "";
    if (data.steps && data.steps.length > 0) {
      const lastStep = data.steps[data.steps.length - 1];
      reply = lastStep.content || lastStep.text || JSON.stringify(lastStep);
    } else if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      reply = data.candidates[0].content.parts[0].text;
    } else if (data.output) {
      reply = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
    } else {
      reply = "গুগল কোনো টেক্সট ফেরত দেয়নি। অনুগ্রহ করে আবার চেষ্টা করুন।";
    }

    return res.status(200).json({ type: 'text', result: reply });

  } catch (error) {
    return res.status(500).json({ error: "সার্ভার এরর: " + error.message });
  }
}
