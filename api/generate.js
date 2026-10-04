export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, category } = req.body;

  // Vercel Environment Variables থেকে সিক্রেট কী রিড করবে
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ 
      error: 'Vercel Environment Variables-এ GEMINI_API_KEY সেট করা হয়নি!' 
    });
  }

  try {
    // ১. ফটো ক্যাটাগরি (গুগলের Imagen 3 দিয়ে তৈরি)
    if (category === 'photo') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: prompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: "1:1",
              outputMimeType: "image/jpeg"
            }
          })
        }
      );

      const data = await response.json();

      if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
        const base64Data = data.predictions[0].bytesBase64Encoded;
        return res.status(200).json({ 
          type: 'image', 
          result: `data:image/jpeg;base64,${base64Data}` 
        });
      } else {
        return res.status(400).json({ 
          error: data.error?.message || "ছবি তৈরি করা যায়নি। প্রম্পট পরিবর্তন করে আবার চেষ্টা করুন।" 
        });
      }
    }

    // ২. কোডিং ও চ্যাট (Gemini 1.5 Flash মডেল)
    let systemInstruction = "";
    if (category === 'coding') {
      systemInstruction = "You are an elite developer. If user asks for any web design or app, provide full runnable single-file HTML/CSS/JavaScript code inside ```html ... ``` block.";
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `${systemInstruction}\nUser prompt: ${prompt}` }]
            }
          ]
        })
      }
    );

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "কোনো উত্তর পাওয়া যায়নি।";
    return res.status(200).json({ type: 'text', result: reply });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
