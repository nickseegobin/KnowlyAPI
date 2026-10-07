const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
let query;
function mock(file, exports) {
  const id = require.resolve(path.resolve(__dirname, '../src', file));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mock('services/embeddings.js', { getEmbedding: async () => [1] });
mock('services/pinecone.js', { getIndex: () => ({ query: async params => {
  query = params;
  return { matches: [{ metadata: { text: 'Verified module training' } }] };
} }) });
mock('services/ai.js', {});
mock('services/curriculumDB.js', {});
mock('config/supabase.js', () => ({}));
const { getCurriculumChunks } = require('../src/services/questGenerator');
test('module generation retrieves training using both supported metadata names', async () => {
  assert.equal(await getCurriculumChunks('tt_primary', 'std_4', 'english', 'term_1', 'Oral Communication', true), 'Verified module training');
  assert.deepEqual(query.filter, { curriculum: 'tt_primary', level: 'std_4', subject: 'english', period: 'term_1', $or: [{ module_title: 'Oral Communication' }, { subtopic: 'Oral Communication' }] });
});
test('single-topic generation retains exact topic matching', async () => {
  await getCurriculumChunks('tt_primary', 'std_4', 'math', 'term_1', 'Addition and Subtraction');
  assert.equal(query.filter.topic, 'Addition and Subtraction');
  assert.equal(query.filter.$or, undefined);
});
