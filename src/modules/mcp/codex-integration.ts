import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify, isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ManagementApiError } from '../app/management-auth';

const execute = promisify(execFile);
const ConfigSchema = z.object({ name: z.string(), enabled: z.boolean(), transport: z.object({
  type: z.string(), command: z.string().optional(), args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).nullable().optional(),
}).passthrough() }).passthrough();
const RecordSchema = z.object({ provider: z.literal('codex'), memberId: z.string().uuid(), config: ConfigSchema }).strict();
export type CodexIntegrationOptions = { root?: string; node?: string; run?: (args: string[]) => Promise<string> };

function codexExecutable() {
  const applications = [join(homedir(), 'Applications'), '/Applications'];
  const candidates = [process.env.APP2049_CODEX_PATH,
    ...applications.flatMap(directory => [
      join(directory, 'ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
      join(directory, 'Codex.app/Contents/Resources/codex'),
    ]), ...(process.env.PATH ?? '').split(':').filter(isAbsolute).map(directory => join(directory, 'codex'))];
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate)) continue;
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* Try the next installed host. */ }
  }
  throw new ManagementApiError('CODEX_NOT_INSTALLED', 409, '未找到 Codex，请先安装 Codex 桌面宿主或 CLI。');
}

/** Codex owns TOML parsing and edits. This adapter owns only its UUID-scoped entry. */
export class CodexIntegration {
  readonly serverName: string;
  readonly recordPath: string;
  private record?: z.infer<typeof RecordSchema>;
  private recordInvalid = false;
  private readonly root: string;
  private readonly node: string;
  constructor(private directory: string, private memberId: string, private options: CodexIntegrationOptions = {}) {
    z.string().uuid().parse(memberId);
    // Keep the full UUID while leaving room for Codex's namespaced tool names.
    this.serverName = `2049-codex-${Buffer.from(memberId.replaceAll('-', ''), 'hex').toString('base64url')}`;
    this.recordPath = join(directory, 'members', memberId, 'codex-integration.json');
    this.root = options.root ?? process.cwd();
    this.node = options.node ?? process.execPath;
    if (existsSync(this.recordPath)) {
      try {
        const record = RecordSchema.parse(JSON.parse(readFileSync(this.recordPath, 'utf8')));
        if (record.memberId !== memberId || record.config.name !== this.serverName) throw new Error('INVALID_CODEX_INTEGRATION');
        this.record = record;
      } catch { this.recordInvalid = true; }
    }
  }
  get configured() { return Boolean(this.record); }
  private async run(args: string[], deadline: number) {
    try {
      if (this.options.run) return await this.options.run(args);
      // The child never receives the App management capability or wallet configuration.
      const env = { HOME: homedir(), PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME, NODE_ENV: process.env.NODE_ENV };
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('CODEX_CONFIGURATION_TIMEOUT');
      const { stdout } = await execute(codexExecutable(), args, { cwd: homedir(), env, timeout: Math.min(8_000, remaining), maxBuffer: 1_048_576 });
      return stdout;
    } catch (error) {
      if (error instanceof ManagementApiError) throw error;
      throw new ManagementApiError('CODEX_CONFIG_FAILED', 503, '无法更新 Codex MCP 配置，请检查 Codex 配置或稍后重试。');
    }
  }
  private async current(deadline: number) {
    try {
      const entries = z.array(ConfigSchema).parse(JSON.parse(await this.run(['mcp', 'list', '--json'], deadline)));
      return entries.find(entry => entry.name === this.serverName);
    } catch (error) {
      if (error instanceof ManagementApiError) throw error;
      throw new ManagementApiError('CODEX_CONFIG_FAILED', 503, '无法读取 Codex MCP 配置。');
    }
  }
  private conflict(): never {
    throw new ManagementApiError('CODEX_CONFIG_CONFLICT', 409, '该 2049 Codex 配置已被其他设置占用或修改；请在 Codex 中检查，2049 未覆盖它。');
  }
  private launch() {
    if (![this.root, this.node, this.directory].every(isAbsolute)) throw new Error('ABSOLUTE_MCP_PATH_REQUIRED');
    const args = ['--import', join(this.root, 'node_modules/tsx/dist/loader.mjs'), join(this.root, 'scripts/mcp.ts')];
    for (const path of [this.node, args[1], args[2]]) if (!existsSync(path))
      throw new ManagementApiError('CODEX_BRIDGE_UNAVAILABLE', 503, '2049 MCP 启动文件不可用，请重新安装 2049。');
    return { type: 'stdio', command: this.node, args, env: {
      APP2049_DATA_DIR: this.directory, APP2049_CARD_MEMBER_ID: this.memberId, APP2049_MCP_PROVIDER: 'codex',
    } };
  }
  private matchesLaunch(config: z.infer<typeof ConfigSchema>) {
    const expected = this.launch();
    return config.enabled && config.transport.type === expected.type && config.transport.command === expected.command
      && isDeepStrictEqual(config.transport.args, expected.args) && isDeepStrictEqual(config.transport.env, expected.env);
  }
  private save(config: z.infer<typeof ConfigSchema>) {
    const record = RecordSchema.parse({ provider: 'codex', memberId: this.memberId, config });
    mkdirSync(join(this.directory, 'members', this.memberId), { recursive: true, mode: 0o700 });
    const temporary = `${this.recordPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
    renameSync(temporary, this.recordPath);
    this.record = record;
  }
  async connect() {
    this.requireValidRecord();
    // One deadline covers all CLI calls, including read-back; a busy home config
    // must not turn a 3-second command limit into a false connection failure.
    const deadline = Date.now() + 12_000;
    const current = await this.current(deadline);
    if (current) {
      if (this.record && !isDeepStrictEqual(current, this.record.config)) this.conflict();
      if (!this.matchesLaunch(current)) this.conflict();
      // Recover a crash after CLI installation but before the local receipt was saved.
      this.save(current);
      return;
    }
    const launch = this.launch();
    const envArgs = Object.entries(launch.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
    await this.run(['mcp', 'add', this.serverName, ...envArgs, '--', launch.command, ...launch.args], deadline);
    const installed = await this.current(deadline);
    if (!installed || !this.matchesLaunch(installed)) throw new ManagementApiError('CODEX_CONFIG_FAILED', 503, 'Codex MCP 配置未确认写入。');
    this.save(installed);
  }
  async disconnect() {
    this.requireValidRecord();
    const deadline = Date.now() + 12_000;
    const current = await this.current(deadline);
    if (current) {
      if (!this.record || !isDeepStrictEqual(current, this.record.config)) this.conflict();
      await this.run(['mcp', 'remove', this.serverName], deadline);
      if (await this.current(deadline)) throw new ManagementApiError('CODEX_CONFIG_FAILED', 503, 'Codex MCP 配置未确认移除。');
    }
    try { unlinkSync(this.recordPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.record = undefined;
  }
  private requireValidRecord() {
    if (this.recordInvalid) throw new ManagementApiError('CODEX_CONFIG_FAILED', 503, '2049 的 Codex 配置记录不可读，未修改 Codex 配置。');
  }
}
