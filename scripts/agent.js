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

  // Ignore internal files
  const reviewFiles = files.filter(
    (f) =>
      f.patch &&
      f.filename !== "scripts/agent.js" &&
      !f.filename.startsWith(".github/")
  );

  if (!reviewFiles.length) {
    console.log("No relevant files to review");
    return;
  }

  // Combine patches (single call, quota-safe)
  const combinedPatch = reviewFiles
    .map((f) => `FILE: ${f.filename}\n${f.patch}`)
    .join("\n\n")
    .slice(0, 6000);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `
You are a strict code reviewer.

Return ONLY JSON:
[
  {
    "file": "filename",
    "line": number,
    "comment": "issue"
  }
]

Rules:
- "line" = line number within the provided patch (starting from 1)
- Do NOT guess actual file line numbers
- Be concise and critical
- No explanation outside JSON

Code:
${combinedPatch}
`;

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

  // Map patch lines → real file lines
  function buildLineMap(patch) {
    const lines = patch.split("\n");
    let map = [];
    let currentLine = 0;

    for (const line of lines) {
      const match = line.match(/^@@.*\+(\d+)/);
      if (match) {
        currentLine = parseInt(match[1], 10);
        continue;
      }

      // Added line
      if (line.startsWith("+") && !line.startsWith("+++")) {
        map.push(currentLine);
        currentLine++;
      }
      // Context line
      else if (!line.startsWith("-")) {
        currentLine++;
      }
    }

    return map;
  }

  let comments = [];

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseJSON(text);

    for (const file of reviewFiles) {
      const lineMap = buildLineMap(file.patch);

      for (const c of parsed) {
        if (!c.file || !c.line || !c.comment) continue;

        if (!file.filename.includes(c.file)) continue;

        const realLine = lineMap[c.line - 1];
        if (!realLine) continue;

        comments.push({
          path: file.filename,
          line: realLine,
          side: "RIGHT",
          body: c.comment,
        });
      }
    }
  } catch (e) {
    console.log("AI failed:", e.message || e);
    return;
  }

  if (!comments.length) {
    console.log("No issues found");
    return;
  }

  // GitHub limit: 30 comments per request
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
  console.error("FATAL:", e);
  process.exit(1);
});
