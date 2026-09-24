import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const KEYCHAIN_SERVICE = 'grreat.ca';
export const KEYCHAIN_ACCOUNT = 'grreat-project';

async function defaultRun(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        const error = new Error(`security exited with status ${code}`);
        error.stderr = stderr;
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

/**
 * Read the PAT from macOS Keychain, with GRREAT_ACCESS_TOKEN as a local fallback.
 * The token is returned to the caller only and is never written to the repository.
 * @param {{ env?: Record<string, string|undefined>, service?: string, run?: (args: string[]) => Promise<string> }} [options]
 */
export async function readAccessToken({
  env = process.env,
  service = KEYCHAIN_SERVICE,
  run = defaultRun,
} = {}) {
  const fallback = typeof env.GRREAT_ACCESS_TOKEN === 'string' ? env.GRREAT_ACCESS_TOKEN.trim() : '';
  if (fallback) return fallback;
  try {
    const value = await run(['find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w']);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export async function storeAccessToken(token, {
  service = KEYCHAIN_SERVICE,
  run = defaultRun,
} = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new TypeError('A non-empty access token is required');
  const secret = Buffer.from(token.trim(), 'utf8');
  try {
    await run(['add-generic-password', '-U', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w'], { input: secret });
  } finally {
    secret.fill(0);
  }
}

export async function removeAccessToken({
  service = KEYCHAIN_SERVICE,
  run = defaultRun,
} = {}) {
  try {
    await run(['delete-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT]);
  } catch (error) {
    // `security` exits non-zero when the item does not exist; removal is idempotent.
    if (!/not found|could not be found|errSecItemNotFound/i.test(String(error?.stderr ?? error?.message ?? error))) throw error;
  }
}

/**
 * Read a token from stdin. Interactive terminals use raw mode so the PAT is
 * never echoed; pipes and test streams are consumed without printing it.
 */
export async function readTokenFromInput(input = process.stdin, output = process.stdout) {
  if (input?.isTTY && typeof input.setRawMode === 'function') {
    return new Promise((resolve, reject) => {
      let token = '';
      const cleanup = () => {
        input.setRawMode(false);
        input.pause();
        input.removeListener('data', onData);
        input.removeListener('error', onError);
      };
      const onError = (error) => { cleanup(); reject(error); };
      const onData = (chunk) => {
        const text = String(chunk);
        for (const character of text) {
          if (character === '\u0003') {
            cleanup();
            reject(new Error('Authentication input cancelled'));
            return;
          }
          if (character === '\r' || character === '\n') {
            cleanup();
            output.write('\n');
            resolve(token.trim());
            return;
          }
          if (character === '\u007f') token = token.slice(0, -1);
          else token += character;
        }
      };
      output.write('GRREAT access token: ');
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
      input.on('error', onError);
    });
  }
  let token = '';
  for await (const chunk of input) token += String(chunk);
  return token.trim();
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  const [action, ...unexpected] = process.argv.slice(2);
  if (action === 'set' || action === 'store') {
    if (unexpected.length > 0) {
      console.error('Usage: node auth.mjs set <stdin>');
      process.exitCode = 2;
    } else {
      const token = await readTokenFromInput();
      await storeAccessToken(token);
    }
  } else if (action === 'remove') {
    await removeAccessToken();
  } else if (action === '--help' || action === '-h') {
    console.log('Usage: node auth.mjs <set|remove>\nRead the token from stdin when setting it.');
  } else {
    console.error('Usage: node auth.mjs <set|remove>');
    process.exitCode = 2;
  }
}
