const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const token = process.env.GITHUB_TOKEN;

  const repo = process.env.GITHUB_REPOSITORY; // owner/repo
  const [owner, repoName] = repo.split("/");

  const prMatch = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
  if (!prMatch) {
    console.log("Not a PR context");
    return;
  }
  const pull_number = prMatch[1];

  // 1. Get changed files
  const filesRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}/files`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  const files = await filesRes.json();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  let comments = [];

  // Helper: extract valid JSON safely
  function extractJSON(text) {
    try {
      const cleaned = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const match = cleaned.match(/\[.*\]/s);
      if (!match) return [];

      return JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  for (const file of files) {
    if (!file.patch) continue;

    // Skip noisy files
    if (
      file.filename.includes("package-lock.json") ||
      file.filename.includes("node_modules")
    ) continue;

    const patch = file.patch.slice(0, 8000); // prevent huge prompts

    const prompt = `
You are a strict senior code reviewer.

Output MUST be ONLY valid JSON.
No markdown. No explanation.

Format:
[
  { "line": number, "comment": "issue" }
]

Rules:
- Only real issues
- If no issues, return []

File: ${file.filename}

Patch:
${patch}
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
    } catch (e) {
      console.log("AI failed for:", file.filename);
    }
  }

  if (comments.length === 0) {
    console.log("No issues found");
    return;
  }

  // 2. Post review (inline comments)
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
        comments: comments.slice(0, 30), // GitHub limit safety
      }),
    }
  );

  console.log(`Posted ${comments.length} comments`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
