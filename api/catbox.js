export const config = {
  api: {
    bodyParser: false, // ফাইল যেন নষ্ট না হয়
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const response = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      body: req,
      duplex: 'half'
    });

    const data = await response.text();
    return res.status(response.status).send(data);
  } catch (error) {
    return res.status(500).send('Upload Error: ' + error.message);
  }
}
