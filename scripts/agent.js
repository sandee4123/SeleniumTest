async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF || "";

  if (!token || !repo) {
    console.error("Missing required env vars: GITHUB_TOKEN, GITHUB_REPOSITORY");
    process.exit(1);
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    console.error("Invalid GITHUB_REPOSITORY format. Expected owner/repo");
    process.exit(1);
  }

  const prMatch = ref.match(/refs\/pull\/(\d+)\//);
  if (!prMatch) {
    console.log("Not a pull request ref. Exiting.");
    return;
  }

  const pullNumber = Number(prMatch[1]);

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pullNumber}`,
    { headers: ghHeaders }
  );

  if (!prRes.ok) {
    console.error("Failed to fetch PR details:", await safeBody(prRes));
    return;
  }

  const prData = await prRes.json();
  const commitId = prData?.head?.sha;
  if (!commitId) {
    console.error("Missing commit SHA in PR details");
    return;
  }

  const files = await fetchAllPrFiles(owner, repoName, pullNumber, ghHeaders);
  if (!files.length) {
    console.log("No files returned by GitHub API");
    return;
  }

  const reviewFiles = files.filter(
    (f) =>
      f.patch &&
      f.status !== "removed" &&
      f.filename !== "scripts/agent.js" &&
      !f.filename.startsWith(".github/")
  );

  if (!reviewFiles.length) {
    console.log("No relevant patched files");
    return;
  }

  const fileContexts = reviewFiles.map((f) => ({
    filename: f.filename,
    parsed: parsePatchWithAbsoluteLines(f.patch),
  }));

  const promptPatch = fileContexts
    .map((fc) => {
      const rendered = fc.parsed.lines
        .map((l) => `[P${l.patchLine}] ${l.raw}`)
        .join("\n");
      return `FILE: ${fc.filename}\n${rendered}`;
    })
    .join("\n\n")
    .slice(0, 18000);

  const prompt = `
You MUST return ONLY valid JSON array. No text, no explanation.

[
  {
    "file": "exact/path/from_FILE_header",
    "patch_line": number,
    "type": "bug|security|performance|style|maintainability|test",
    "comment": "short actionable issue"
  }
]

Code:
${promptPatch}
`;

  let aiText;
  try {
    aiText = await callGitHubModel(prompt, token);
  } catch (e) {
    console.error("AI request failed:", e?.message || e);
    return;
  }

  const aiIssues = parseJSON(aiText);
  if (!Array.isArray(aiIssues) || aiIssues.length === 0) {
    console.log("No issues found by AI");
    return;
  }

  let comments = [];
  for (const issue of aiIssues) {
    const fc = fileContexts.find((x) => x.filename === issue.file);
    if (!fc) continue;

    const rec = fc.parsed.byPatchLine.get(issue.patch_line);
    if (!rec || rec.kind !== "add") continue;

    comments.push({
      path: fc.filename,
      line: rec.newLine,
      side: "RIGHT",
      body: `[AI Review]: ${issue.comment}`,
    });
  }

  if (!comments.length) {
    console.log("No valid mappable comments");
    return;
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pullNumber}/reviews`,
    {
      method: "POST",
      headers: {
        ...ghHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        commit_id: commitId,
        event: "COMMENT",
        comments,
      }),
    }
  );

  if (!res.ok) {
    console.error("GitHub API error:", await safeBody(res));
    return;
  }

  console.log(`Posted ${comments.length} comments`);
}

async function callGitHubModel(prompt, token) {
  const models = ["gpt-4o-mini", "gpt-4o"];

  for (const model of models) {
    try {
      console.log("Trying:", model);

      const res = await fetch("https://models.inference.ai.azure.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Return ONLY JSON array." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
      });

      const data = await res.json();
      let text = data?.choices?.[0]?.message?.content;

      if (!text) continue;

      text = text.replace(/```json|```/g, "").trim();

      console.log("Model used:", model);
      console.log("RAW:", text);

      return text;
    } catch (e) {
      continue;
    }
  }

  throw new Error("All models failed");
}

async function fetchAllPrFiles(owner, repoName, pullNumber, headers) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pullNumber}/files`,
    { headers }
  );
  return await res.json();
}

function parsePatchWithAbsoluteLines(patch) {
  const lines = patch.split("\n");
  const byPatchLine = new Map();
  let newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const patchLine = i + 1;

    if (raw.startsWith("@@")) {
      const match = raw.match(/\+(\d+)/);
      if (match) newLine = Number(match[1]);
    } else if (raw.startsWith("+")) {
      byPatchLine.set(patchLine, { kind: "add", newLine });
      newLine++;
    } else if (!raw.startsWith("-")) {
      newLine++;
    }
  }

  return { byPatchLine };
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      return JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
}

async function safeBody(res) {
  try {
    return await res.json();
  } catch {
    return await res.text();
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
