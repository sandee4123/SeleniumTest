const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repo.split("/");

  const prMatch = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
  if (!prMatch) return;

  const pull_number = prMatch[1];

  // Fetch PR files
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

  // 🔥 Robust JSON extractor (handles garbage output)
  function extractJSON(text) {
    try {
      const cleaned = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      // Try direct parse
      try {
        return JSON.parse(cleaned);
      } catch {}

      // Try extract array
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]);
      }

      // Fallback: convert plain text → comments
      const lines = cleaned.split("\n").filter(l => l.trim());
      return lines.slice(0, 5).map((line, i) => ({
        line: i + 1,
        comment: "[AI REVIEW] " + line.trim(),
      }));

    } catch {
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

    // 🔥 Java (Selenium-focused)
    if (file.filename.endsWith(".java")) {
      prompt = `
You are a strict Selenium reviewer.

You MUST return at least 5 issues.

Output ONLY JSON:
[
  { "line": number, "comment": "issue" }
]

Rules:
- No explanation
- No markdown
- Be aggressive
- Flag everything (even minor issues)
- Include: waits, locators, driver misuse, null issues, bad practices

If no issues found, STILL return 5 issues.

File: ${file.filename}

Patch:
${file.patch.slice(0, 8000)}
      `;
    }

    // 🔥 Workflow files
    else if (file.filename.includes(".github/workflows")) {
      prompt = `
You are a CI/CD reviewer.

You MUST return at least 3 issues.

Output ONLY JSON:
[
  { "line": number, "comment": "issue" }
]

Focus on:
- missing triggers
- permissions
- dependency handling
- version pinning

File: ${file.filename}

Patch:
${file.patch.slice(0, 8000)}
      `;
    }

    // 🔥 Generic
    else {
      prompt = `
You are a strict code reviewer.

Return at least 3 issues.

Output ONLY JSON:
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

      console.log("AI RAW RESPONSE:\n", text); // debug

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

  if (!comments.length) {
    console.log("Still no issues — forcing fallback comments");

    comments.push({
      path: files[0]?.filename || "unknown",
      line: 1,
      body: "[AI REVIEW] Fallback: Potential issues exist but AI response parsing failed",
    });
  }

  // GitHub limit: 30 per request
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
  console.error("ERROR:", e);
  process.exit(1);
});
