const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repo.split("/");

  const prMatch = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
  if (!prMatch) return;

  const pull_number = prMatch[1];

  // ---- PR details ----
  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );
  const prData = await prRes.json();
  const commit_id = prData.head.sha;

  // ---- PR files ----
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

  const reviewFiles = files.filter(
    (f) =>
      f.patch &&
      f.filename !== "scripts/agent.js" &&
      !f.filename.startsWith(".github/")
  );

  if (!reviewFiles.length) {
    console.log("No relevant files");
    return;
  }

  // ---- Combine patch ----
  const combinedPatch = reviewFiles
    .map((f) => `FILE: ${f.filename}\n${f.patch}`)
    .join("\n\n")
    .slice(0, 6000);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // ---- Prompt ----
  const prompt = `
You are a strict senior code reviewer.

Return ONLY JSON:
[
  {
    "file": "filename",
    "line": number,
    "type": "issue_category",
    "comment": "issue"
  }
]

Rules:
- line = approximate line in patch
- ONLY comment on visible code
- DO NOT hallucinate
- DO NOT repeat issues
- Be concise

Code:
${combinedPatch}
`;

  // ---- Gemini fallback ----
  async function callGemini(genAI, prompt) {
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

    for (const name of models) {
      try {
        console.log("Trying:", name);
        const model = genAI.getGenerativeModel({ model: name });

        const res = await model.generateContent(prompt);
        const text = res.response.text();

        if (text && text.trim()) return text;
      } catch (e) {
        const msg = e.message || "";
        if (msg.includes("429") || msg.includes("503")) continue;
        throw e;
      }
    }

    throw new Error("All models failed");
  }

  // ---- JSON parse ----
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

  // ---- BUILD POSITION MAP (CORRECT) ----
  function buildPositionMap(patch) {
    const lines = patch.split("\n");

    let position = 0;
    const map = [];

    for (const line of lines) {
      // skip metadata
      if (
        line.startsWith("diff --git") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@")
      ) {
        map.push(null);
        continue;
      }

      position++;
      map.push(position);
    }

    return map;
  }

  let comments = [];

  try {
    const text = await callGemini(genAI, prompt);
    const parsed = parseJSON(text);

    for (const file of reviewFiles) {
      const posMap = buildPositionMap(file.patch);

      const validPositions = posMap.filter((p) => p !== null);

      if (!validPositions.length) continue;

      for (const c of parsed) {
        if (!c.comment) continue;
        if (c.file && !file.filename.endsWith(c.file)) continue;

        let idx = (c.line || 1) - 1;

        if (idx < 0) idx = 0;
        if (idx >= posMap.length) idx = posMap.length - 1;

        let position = posMap[idx];

        // fallback if landed on null
        if (!position) {
          position = validPositions[Math.min(validPositions.length - 1, idx)];
        }

        if (!position) continue;

        comments.push({
          path: file.filename,
          position,
          body: c.comment,
          _type: c.type || "general",
        });
      }
    }
  } catch (e) {
    console.error("AI failed:", e.message || e);
    return;
  }

  if (!comments.length) {
    console.log("No issues found");
    return;
  }

  // ---- Deduplicate ----
  const seen = new Set();
  comments = comments.filter((c) => {
    const key = `${c.path}:${c._type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ---- Sort ----
  comments.sort((a, b) => {
    if (a.path === b.path) return a.position - b.position;
    return a.path.localeCompare(b.path);
  });

  // ---- Clean payload ----
  const clean = comments.map(({ path, position, body }) => ({
    path,
    position,
    body,
  }));

  // ---- Send to GitHub ----
  const chunkSize = 30;

  for (let i = 0; i < clean.length; i += chunkSize) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}/reviews`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          commit_id,
          event: "COMMENT",
          comments: clean.slice(i, i + chunkSize),
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("GitHub API ERROR:", data);
    }
  }

  console.log(`Posted ${clean.length} comments`);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
