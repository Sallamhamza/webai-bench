import embeddingFixture from "@webai-bench/registry/fixtures/embedding-sentences.json";

// Standard input fixtures (04-benchmark-methodology.md §2) shared by every cell of a given
// task type. There are currently exactly two fixture files in the registry (llm-prompt.txt,
// embedding-sentences.json) and exactly two task shapes (generation, embedding), so dispatch is
// by runtime rather than by each cell's own fixture_path — see adapterFactory.ts.

// Same text as packages/registry/fixtures/llm-prompt.txt. Inlined (not a raw import) since
// apps/web's tsconfig doesn't currently pull in vite/client's `*.txt?raw` module typings.
export const LLM_PROMPT = `You are a helpful assistant. Read the following passage carefully, then answer the question at the end in a clear, well-organized paragraph.

Passage: A public library in a mid-sized town recently completed a renovation that added a dedicated quiet study area, a small recording studio for community podcasts, and a room for tutoring sessions run by local volunteers. The library's staff reported that visits from teenagers increased noticeably after the renovation, particularly in the late afternoon after school lets out. Circulation of physical books stayed roughly flat compared to the previous year, but the number of people using the library's computers and study spaces rose by nearly a third. The library director noted that the renovation was funded through a combination of a state grant, a matching contribution from the town council, and a smaller fundraising campaign organized by a group of local parents. Several other libraries in the region have since sent staff to tour the renovated space, considering similar upgrades of their own. The director cautioned that the renovation alone was not responsible for the increase in visits; a new after-school bus route that stops directly outside the library also began running the same month, and staff believe both changes together explain the change in patterns.

Question: Based on the passage, what factors most likely contributed to the increase in library visits, and why might it be difficult to attribute the change to any single cause?`;

export const EMBEDDING_SENTENCES: readonly string[] = embeddingFixture.sentences;
