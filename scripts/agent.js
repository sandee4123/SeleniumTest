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

  // Filter relevant files
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

  // Combine patches
  const combinedPatch = reviewFiles
    .map((f) => `FILE: ${f.filename}\n${f.patch}`)
    .join("\n\n")
    .slice(0, 6000);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `
You are a strict senior code reviewer.

Return ONLY JSON:
[
  {
    "file": "filename",
    "line": number,
    "type": "issue_category",
    "comment": "issue description"
  }
]

Rules:
- "line" = position inside patch (starting from 1)
- Group similar issues under the same "type"
- If multiple occurrences exist, mention them in ONE comment
- Do NOT repeat same issue type for nearby lines
- Be concise
- No explanation outside JSON

Code:
${combinedPatch}
`;

  // Retry wrapper
  async function callGeminiWithRetry(model, prompt, retries = 3) {
    let delay = 2000;

    for (let i = 0; i < retries; i++) {
      try {
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (e) {
        const msg = e.message || "";

        if (msg.includes("503") || msg.includes("429")) {
          if (i === retries - 1) throw e;
          await new Promise((r) =>
            setTimeout(r, delay + Math.random() * 1000)
          );
          delay *= 2;
        } else {
          throw e;
        }
      }
    }
  }

  // Robust parser
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

      // fallback
      const lines = text.split("\n").filter((l) => l.trim());
      return lines.slice(0, 8).map((line, i) => ({
        file: "",
        line: i + 1,
        type: "general",
        comment: line.trim(),
      }));
    }
  }

  let comments = [];

  try {
    const text = await callGeminiWithRetry(model, prompt);
    const parsed = parseJSON(text);

    for (const file of reviewFiles) {
      const maxPos = file.patch.split("\n").length;

      for (const c of parsed) {
        if (!c.comment) continue;

        if (c.file && !file.filename.endsWith(c.file)) continue;

        let pos = c.line || 1;
        if (pos < 1) pos = 1;
        if (pos > maxPos) pos = maxPos;

        comments.push({
          path: file.filename,
          position: pos,
          body: c.comment,
          type: c.type || "general",
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

  // Deduplicate by type (AI-driven grouping)
  const seen = new Set();
  comments = comments.filter((c) => {
    const key = `${c.path}:${c.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort
  comments.sort((a, b) => {
    if (a.path === b.path) return a.position - b.position;
    return a.path.localeCompare(b.path);
  });

  // GitHub limit
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
