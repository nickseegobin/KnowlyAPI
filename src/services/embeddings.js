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

async function getEmbeddings(texts) {
  if (!texts.length) return [];
  const response = await getVoyage().embed({ input: texts, model: 'voyage-3' });
  const rows = [...response.data].sort((a, b) => a.index - b.index);
  if (rows.length !== texts.length) throw new Error('Incomplete embedding batch');
  return rows.map(row => row.embedding);
}

module.exports = { getEmbedding, getEmbeddings };
