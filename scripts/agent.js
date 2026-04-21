const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repo.split("/");

  const prMatch = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
  if (!prMatch) return;

  const pull_number = prMatch[1];

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

  function parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {}
      }
      return [];
    }
  }

  for (const file of files) {
    if (!file.patch) continue;

    if (
      file.filename.includes("node_modules") ||
      file.filename.includes("package-lock.json")
    ) continue;

    let prompt;

    if (file.filename.endsWith(".java")) {
      prompt = `
You are a Selenium test reviewer.

Return ONLY JSON:
[
  { "line": number, "comment": "issue" }
]

Rules:
- Only real issues
- No fabricated issues
- No explanation outside JSON

File: ${file.filename}

Patch:
${file.patch.slice(0, 8000)}
      `;
    }

    else if (file.filename.includes(".github/workflows")) {
      prompt = `
You are a CI/CD reviewer.

Return ONLY JSON:
[
  { "line": number, "comment": "issue" }
]

Focus on:
- triggers
- permissions
- dependency usage

File: ${file.filename}

Patch:
${file.patch.slice(0, 8000)}
      `;
    }

    else {
      prompt = `
You are a code reviewer.

Return ONLY JSON:
[
  { "line": number, "comment": "issue" }
]

File: ${file.filename}

Patch:
${file.patch.slice(0, 8000)}
      `;
    }

    try {
      const result = await model.generateContent(prompt);
      const text = (await result.response).text();

      const parsed = parseJSON(text);

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
