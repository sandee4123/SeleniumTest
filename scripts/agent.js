const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repo.split("/");

  const prMatch = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
  if (!prMatch) return;

  const pull_number = prMatch[1];

  // Get PR files
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}/files`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  const files = await res.json();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  let comments = [];

  // Safe JSON extractor
  function extractJSON(text) {
    try {
      const cleaned = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const match = cleaned.match(/\[.*\]/s);
      return match ? JSON.parse(match[0]) : [];
    } catch {
      return [];
    }
  }

  for (const file of files) {
    if (!file.patch) continue;

    // Skip noisy files
    if (
      file.filename.includes("node_modules") ||
      file.filename.includes("package-lock.json")
    ) continue;

    const prompt = `
You are a highly critical senior code reviewer.

Your job is to FIND PROBLEMS aggressively.

Prefix every comment with: [AI REVIEW]

Output ONLY JSON:
[
  { "line": number, "comment": "issue" }
]

Rules:
- Be strict. Assume code is flawed.
- Flag even minor issues
- Include:
  - Bad naming
  - Missing validations
  - Poor error handling
  - Performance issues
  - Test flakiness (important for Selenium)
- If unsure, still flag as "potential issue"

If truly perfect, return []

File: ${file.filename}

Patch:
${file.patch.slice(0, 8000)}
    `;

    try {
      const result = await model.generateContent(prompt);
      const text = (await result.response).text();

      const parsed = extractJSON(text);

      for (const c of parsed) {
        if (!c.line || !c.comment) continue;

        comments.push({
          path: file.filename,
          line: c.line,
          body: c.comment,
        });
      }
    } catch {
      console.log("AI failed for:", file.filename);
    }
  }

  if (!comments.length) {
    console.log("No issues found");
    return;
  }

  // Chunked posting (GitHub limit)
  const chunkSize = 30;

  for (let i = 0; i < comments.length; i += chunkSize) {
    await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}/reviews`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          event: "COMMENT",
          comments: comments.slice(i, i + chunkSize),
        }),
      }
    );
  }

  console.log(`Posted ${comments.length} comments`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
