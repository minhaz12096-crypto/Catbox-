export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, category } = req.body;
  const rawKey = process.env.GEMINI_API_KEY;

  if (!rawKey) {
    return res.status(500).json({ 
      error: 'Vercel-এ GEMINI_API_KEY সেট করা নেই! দয়া করে Environment Variables চেক করুন।' 
    });
  }

  // কোনো বাড়তি স্পেস থাকলে তা মুছে ফেলা (.trim)
  const GEMINI_API_KEY = rawKey.trim();

  try {
    // ==========================================
    // ১. ফটো জেনারেশন
    // ==========================================
    if (category === 'photo') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict`,
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
      if (data.error) {
        return res.status(400).json({ error: `গুগল ইমেজ এরর: ${data.error.message}` });
      }

      if (data.predictions?.[0]?.bytesBase64Encoded) {
        return res.status(200).json({ 
          type: 'image', 
          result: `data:image/jpeg;base64,${data.predictions[0].bytesBase64Encoded}` 
        });
      }
      return res.status(400).json({ error: "ছবি তৈরি করা যায়নি।" });
    }

    // ==========================================
    // ২. কোডিং ও চ্যাট (x-goog-api-key হেডারসহ)
    // ==========================================
    let systemInstruction = "";
    if (category === 'coding') {
      systemInstruction = "You are an elite developer. If user asks for any web design or app, provide full runnable single-file HTML/CSS/JavaScript code inside ```html ... ``` block.\n";
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `${systemInstruction}User prompt: ${prompt}` }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    // গুগল কোনো এরর দিলে সরাসরি সেই এরর স্ক্রিনে দেখাবে
    if (data.error) {
      return res.status(400).json({ 
        error: `Google API Error: ${data.error.message} (Code: ${data.error.code})` 
      });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) {
      return res.status(200).json({ type: 'text', result: "গুগল কোনো টেক্সট ফেরত দেয়নি।" });
    }

    return res.status(200).json({ type: 'text', result: reply });

  } catch (error) {
    return res.status(500).json({ error: "সার্ভার এরর: " + error.message });
  }
}
