const { VoyageAIClient } = require('voyageai');

let client = null;

function getVoyage() {
  if (!client) {
    client = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
  }
  return client;
}

async function getEmbedding(text) {
  const response = await getVoyage().embed({
    input: [text],
    model: 'voyage-3',
  });
  return response.data[0].embedding;
}

module.exports = { getEmbedding };
