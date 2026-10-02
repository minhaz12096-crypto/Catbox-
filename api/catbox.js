export const config = {
  api: {
    bodyParser: false, // ফাইল যেন কোনোভাবেই কেটে না যায় বা নষ্ট না হয়
  },
};

export default async function handler(req, res) {
  // CORS হেডার যুক্ত করা হলো
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // সম্পূর্ণ ফাইল স্ট্রিমটিকে মেমোরি বাফারে জমা করা হচ্ছে
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyBuffer = Buffer.concat(chunks);

    // ক্যাটবক্স সার্ভারে নিখুঁতভাবে ফাইল ফরোয়ার্ড করা
    const catboxRes = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      headers: {
        'content-type': req.headers['content-type'] || 'multipart/form-data',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: bodyBuffer,
    });

    const result = await catboxRes.text();
    return res.status(catboxRes.status).send(result);
  } catch (err) {
    return res.status(500).send('Proxy Server Error: ' + err.message);
  }
}
