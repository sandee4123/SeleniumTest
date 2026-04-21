const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const token = process.env.GITHUB_TOKEN;

  const repo = process.env.GITHUB_REPOSITORY; // owner/repo
  const [owner, repoName] = repo.split("/");

  const pull_number = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//)[1];

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

  for (const file of files) {
    if (!file.patch) continue;

    if (
      file.filename.includes("package-lock.json") ||
      file.filename.includes("node_modules")
    ) continue;

    const prompt = `
You are a strict senior code reviewer.

Return ONLY valid JSON:
[
  { "line": number, "comment": "issue" }
]

File: ${file.filename}

Patch:
${file.patch}
    `;

    try {
      const result = await model.generateContent(prompt);
      const text = (await result.response).text();

      const parsed = JSON.parse(text);

      for (const c of parsed) {
        comments.push({
          path: file.filename,
          line: c.line,
          body: c.comment,
        });
      }
    } catch (e) {
      console.log("Parse failed:", file.filename);
    }
  }

  if (comments.length === 0) return;

  // 2. Post review
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
        comments: comments.slice(0, 30),
      }),
    }
  );

  console.log("Review posted");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
