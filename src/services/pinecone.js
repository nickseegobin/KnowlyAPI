const { Pinecone } = require('@pinecone-database/pinecone');

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

function getIndex() {
  return pinecone.index(process.env.PINECONE_INDEX);
}

async function queryIndex({ standard, term, subject, topK = 10 }) {
  // This will be called at generation time to retrieve curriculum chunks
  const index = getIndex();
  const filter = { standard, subject };
  if (term) filter.term = term;

  // Placeholder — real query needs an embedding vector
  // Will be wired up when OpenAI embeddings are added in Sprint 2
  return { index, filter };
}

async function upsertChunks(chunks) {
  const index = getIndex();
  await index.upsert(chunks);
}

module.exports = { getIndex, queryIndex, upsertChunks };