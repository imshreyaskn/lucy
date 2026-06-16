const https = require('https');

const API_KEY = process.env.GROQ_API_KEY || 'YOUR_API_KEY_HERE';

async function testTTS() {
  const data = JSON.stringify({
    model: 'playai-tts', // Or maybe we can get a list of models?
    voice: 'Fritz-PlayAI', 
    input: 'Hello world',
    response_format: 'mp3'
  });

  const req = https.request('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let body = '';
    res.on('data', chunk => body += chunk.toString('utf8'));
    res.on('end', () => console.log('BODY:', body.substring(0, 500)));
  });

  req.on('error', console.error);
  req.write(data);
  req.end();
}

async function listModels() {
  const req = https.request('https://api.groq.com/openai/v1/models', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk.toString('utf8'));
    res.on('end', () => {
      try {
        const models = JSON.parse(body);
        console.log('Available models:', models.data.map(m => m.id).filter(id => id.includes('tts') || id.includes('audio')));
      } catch(e) {
        console.log('Failed to parse models', body.substring(0, 200));
      }
      testTTS();
    });
  });
  req.end();
}

listModels();
