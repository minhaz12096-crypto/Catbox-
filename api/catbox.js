export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);

    const catboxRes = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      headers: {
        'content-type': req.headers['content-type'] || 'multipart/form-data',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      body: bodyBuffer,
    });

    const result = await catboxRes.text();
    return res.status(catboxRes.status).send(result);
  } catch (err) {
    return res.status(500).send('Proxy Error: ' + err.message);
  }
}
