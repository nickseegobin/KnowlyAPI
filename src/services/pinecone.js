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

async function queryIndex({ standard, term, subject, topK = 10 }) {
  const index = getIndex();
  const filter = { standard, subject };
  if (term) filter.term = term;
  return { index, filter };
}

async function upsertChunks(chunks) {
  const index = getIndex();
  await index.upsert(chunks);
}

module.exports = { getIndex, queryIndex, upsertChunks };