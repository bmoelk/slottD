import http from 'http';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8788;
const HOST = '127.0.0.1';
const defaultNeutralRepo = process.env.REPO_PATH || path.resolve(cmsRootDir, '../websites-deployed/brainendeavor.com');

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // Set CORS headers so Studio UI and Worker can call the bridge
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || '/';

  // 1. Health check
  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', bridge: 'slottd-git-bridge', port: PORT }));
    return;
  }

  // 2. Execute release (Export from D1, commit, tag, push via host SSH)
  if (url === '/exec/release' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const tag = body.tag || `release-${Date.now()}`;
    const message = body.message || `chore(content): release snapshot ${tag}`;
    const push = body.push !== false;
    const repoPath = (body.repoPath && fs.existsSync(body.repoPath)) ? body.repoPath : defaultNeutralRepo;

    let outputLog = '';

    try {
      // Step A: Trigger fresh export from D1 to content files if sync script exists
      const syncScriptPath = path.join(cmsRootDir, 'scripts', 'sync-git.ts');
      if (fs.existsSync(syncScriptPath)) {
        outputLog += `[Bridge] Exporting active D1 database to ${repoPath}...\n`;
        try {
          const exportOutput = execSync(`npx tsx scripts/sync-git.ts --export`, {
            cwd: cmsRootDir,
            encoding: 'utf8',
          });
          outputLog += exportOutput.trim() + '\n';
        } catch (exportErr: any) {
          outputLog += `[Notice] Export warning: ${exportErr.message}\n`;
        }
      }

      // Step B: Git add, commit, tag
      outputLog += `[Bridge] Staging changes in ${repoPath}...\n`;
      execSync(`git -C "${repoPath}" add -A`, { encoding: 'utf8' });

      outputLog += `[Bridge] Creating commit...\n`;
      const commitRes = execSync(
        `git -C "${repoPath}" commit -m "${message.replace(/"/g, '\\"')}" || true`,
        { encoding: 'utf8' }
      );
      if (commitRes.trim()) outputLog += commitRes.trim() + '\n';

      outputLog += `[Bridge] Creating annotated tag '${tag}'...\n`;
      const tagRes = execSync(
        `git -C "${repoPath}" tag -a "${tag.replace(/"/g, '\\"')}" -m "${message.replace(/"/g, '\\"')}" || true`,
        { encoding: 'utf8' }
      );
      if (tagRes.trim()) outputLog += tagRes.trim() + '\n';

      // Step C: Push via host SSH key
      if (push) {
        outputLog += `[Bridge] Pushing commit and tag to Git remote (SSH)...\n`;
        const pushRes = execSync(
          `git -C "${repoPath}" push origin HEAD && git -C "${repoPath}" push origin "${tag.replace(/"/g, '\\"')}"`,
          { encoding: 'utf8' }
        );
        if (pushRes.trim()) outputLog += pushRes.trim() + '\n';
        outputLog += `✅ Release '${tag}' successfully pushed to remote!\n`;
      } else {
        outputLog += `✓ Tagged locally (push skipped per options).\n`;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: `Successfully created and pushed release '${tag}' via host Git!`,
          output: outputLog.trim(),
        })
      );
    } catch (err: any) {
      const errDetail = err.stdout || err.stderr || err.message;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: `Git operation failed: ${err.message}`,
          output: outputLog + '\n' + errDetail,
        })
      );
    }
    return;
  }

  // 3. Fetch remote tags
  if (url === '/exec/fetch' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const repoPath = (body.repoPath && fs.existsSync(body.repoPath)) ? body.repoPath : defaultNeutralRepo;
    try {
      const fetchOutput = execSync(`git -C "${repoPath}" fetch --tags origin`, { encoding: 'utf8' });
      const tagsRaw = execSync(`git -C "${repoPath}" tag -l --sort=-creatordate`, { encoding: 'utf8' });
      const tags = tagsRaw.split('\n').map((t) => t.trim()).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tags, output: fetchOutput || 'Tags fetched successfully.' }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, output: err.stdout || err.stderr || err.message }));
    }
    return;
  }

  // 4. Git diff preview
  if (url === '/exec/diff' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const repoPath = (body.repoPath && fs.existsSync(body.repoPath)) ? body.repoPath : defaultNeutralRepo;
    const tag = body.tag || '';
    try {
      const diffOutput = execSync(`git -C "${repoPath}" diff --stat "${tag}"`, { encoding: 'utf8' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: diffOutput || 'Working directory matches tag (0 changes).' }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, output: err.stdout || err.stderr || err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found on Git bridge' }));
});

server.listen(PORT, HOST, () => {
  console.log(`🔌 SlottD Universal Git Bridge active on http://${HOST}:${PORT}`);
  console.log(`   Target Content Repository: ${defaultNeutralRepo}`);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
