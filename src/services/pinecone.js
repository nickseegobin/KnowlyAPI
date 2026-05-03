const { Pinecone } = require('@pinecone-database/pinecone');

let client = null;

function getPinecone() {
  if (!client) {
    client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  }
  return client;
}

function getIndex() {
  return getPinecone().index(process.env.PINECONE_INDEX);
}

async function queryIndex({ level, period, subject, topK = 10 }) {
  const index = getIndex();
  const filter = { level, subject };
  if (period) filter.period = period;
  return { index, filter };
}

async function upsertChunks(chunks) {
  const index = getIndex();
  await index.upsert({ records: chunks });
}

module.exports = { getIndex, queryIndex, upsertChunks };