import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify, isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ManagementApiError } from '../app/management-auth';
import { resolveYoshConfiguration } from '../app/yosh-configuration';

const execute = promisify(execFile);
const ConfigSchema = z.object({ name: z.string(), enabled: z.boolean(), transport: z.object({
  type: z.string(), command: z.string().optional(), args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).nullable().optional(),
}).passthrough() }).passthrough();
const RecordSchema = z.object({ provider: z.literal('codex'), memberId: z.string().uuid(), config: ConfigSchema }).strict();
const RenameSchema = z.object({ previous: RecordSchema, expected: ConfigSchema }).strict();
export type CodexIntegrationOptions = { root?: string; node?: string; run?: (args: string[]) => Promise<string> };

function codexExecutable() {
  const applications = [join(homedir(), 'Applications'), '/Applications'];
  const candidates = [resolveYoshConfiguration().codexPath,
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
  readonly legacyServerName: string;
  readonly migrationPath: string;
  private record?: z.infer<typeof RecordSchema>;
  private recordInvalid = false;
  private migration?: Promise<void>;
  private readonly root: string;
  private readonly node: string;
  constructor(private directory: string, private memberId: string, private options: CodexIntegrationOptions = {}) {
    z.string().uuid().parse(memberId);
    // Keep the full UUID while leaving room for Codex's namespaced tool names.
    const identity = Buffer.from(memberId.replaceAll('-', ''), 'hex').toString('base64url');
    this.serverName = `yosh-codex-${identity}`;
    this.legacyServerName = `2049-codex-${identity}`;
    this.recordPath = join(directory, 'members', memberId, 'codex-integration.json');
    this.migrationPath = join(directory, 'members', memberId, 'codex-integration-rename.json');
    this.root = options.root ?? process.cwd();
    this.node = options.node ?? process.execPath;
    if (existsSync(this.recordPath)) {
      try {
        const record = RecordSchema.parse(JSON.parse(readFileSync(this.recordPath, 'utf8')));
        if (record.memberId !== memberId || ![this.serverName, this.legacyServerName].includes(record.config.name)) throw new Error('INVALID_CODEX_INTEGRATION');
        this.record = record;
      } catch { this.recordInvalid = true; }
    }
  }
  get configured() { return Boolean(this.record); }
  get needsMigration() { return this.record?.config.name === this.legacyServerName || existsSync(this.migrationPath); }
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
  private async entries(deadline: number) {
    try {
      return z.array(ConfigSchema).parse(JSON.parse(await this.run(['mcp', 'list', '--json'], deadline)));
    } catch (error) {
      if (error instanceof ManagementApiError) throw error;
      throw new ManagementApiError('CODEX_CONFIG_FAILED', 503, '无法读取 Codex MCP 配置。');
    }
  }
  private async current(deadline: number) {
    return (await this.entries(deadline)).find(entry => entry.name === this.serverName);
  }
  private conflict(): never {
    throw new ManagementApiError('CODEX_CONFIG_CONFLICT', 409, '该 Yosh Codex 配置已被其他设置占用或修改；请在 Codex 中检查，Yosh 未覆盖它。');
  }
  private launch() {
    if (![this.root, this.node, this.directory].every(isAbsolute)) throw new Error('ABSOLUTE_MCP_PATH_REQUIRED');
    const args = ['--import', join(this.root, 'node_modules/tsx/dist/loader.mjs'), join(this.root, 'scripts/mcp.ts')];
    for (const path of [this.node, args[1], args[2]]) if (!existsSync(path))
      throw new ManagementApiError('CODEX_BRIDGE_UNAVAILABLE', 503, 'Yosh MCP 启动文件不可用，请重新安装 Yosh。');
    return { type: 'stdio', command: this.node, args, env: {
      YOSH_DATA_DIR: this.directory, YOSH_CARD_MEMBER_ID: this.memberId, YOSH_MCP_PROVIDER: 'codex',
    } };
  }
  private matchesLaunch(config: z.infer<typeof ConfigSchema>) {
    const expected = this.launch();
    return config.enabled && config.transport.type === expected.type && config.transport.command === expected.command
      && isDeepStrictEqual(config.transport.args, expected.args) && isDeepStrictEqual(config.transport.env, expected.env);
  }
  private matchesLegacyMember(config: z.infer<typeof ConfigSchema>) {
    try {
      const environment = resolveYoshConfiguration(config.transport.env ?? {});
      return config.enabled && config.transport.type === 'stdio' && isAbsolute(config.transport.command ?? '')
        && config.transport.args?.length === 3 && config.transport.args[0] === '--import'
        && environment.cardMemberId === this.memberId && environment.dataDirectory === this.directory
        && environment.mcpProvider === 'codex';
    } catch { return false; }
  }
  private save(config: z.infer<typeof ConfigSchema>) {
    const record = RecordSchema.parse({ provider: 'codex', memberId: this.memberId, config });
    this.writePrivate(this.recordPath, record);
    this.record = record;
  }
  private writePrivate(path: string, value: unknown) {
    mkdirSync(join(this.directory, 'members', this.memberId), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flush: true });
    renameSync(temporary, path);
  }
  private async install(deadline: number) {
    const launch = this.launch();
    const envArgs = Object.entries(launch.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
    await this.run(['mcp', 'add', this.serverName, ...envArgs, '--', launch.command, ...launch.args], deadline);
  }
  /** A receipt proves ownership; the journal preserves it across removing the old entry.
   * Remove/read back before adding, so a rename never exposes two member capabilities.
   */
  async migrateLegacy() {
    this.requireValidRecord();
    if (!this.needsMigration) return;
    this.migration ??= this.renameOwnedEntry().finally(() => { this.migration = undefined; });
    return this.migration;
  }
  private async renameOwnedEntry() {
    // A rename needs five CLI calls (remove/read back/add/read back), while a
    // normal Connect needs three. Allow slow host startup without an unbounded wait.
    const deadline = Date.now() + 20_000;
    let journal: z.infer<typeof RenameSchema>;
    const entries = await this.entries(deadline);
    let previous = entries.find(entry => entry.name === this.legacyServerName);
    let current = entries.find(entry => entry.name === this.serverName);
    if (existsSync(this.migrationPath)) {
      try { journal = RenameSchema.parse(JSON.parse(readFileSync(this.migrationPath, 'utf8'))); }
      catch { throw new ManagementApiError('CODEX_CONFIG_FAILED', 503, 'Yosh 的连接迁移记录不可读，未修改 Codex 配置。'); }
      if (journal.previous.memberId !== this.memberId || journal.previous.config.name !== this.legacyServerName
        || !this.matchesLegacyMember(journal.previous.config)
        || journal.expected.name !== this.serverName || !this.matchesLaunch(journal.expected)) this.conflict();
      if (!this.record || (this.record.config.name === this.legacyServerName
        && !isDeepStrictEqual(this.record, journal.previous))) this.conflict();
    } else {
      if (!this.record || this.record.config.name !== this.legacyServerName || !previous
        || !this.matchesLegacyMember(previous) || !isDeepStrictEqual(previous, this.record.config) || current) this.conflict();
      journal = { previous: this.record, expected: { name: this.serverName, enabled: true, transport: this.launch() } };
      this.writePrivate(this.migrationPath, journal);
    }
    if (previous) {
      if (!isDeepStrictEqual(previous, journal.previous.config) || current) this.conflict();
      await this.run(['mcp', 'remove', this.legacyServerName], deadline);
      const after = await this.entries(deadline);
      previous = after.find(entry => entry.name === this.legacyServerName);
      current = after.find(entry => entry.name === this.serverName);
      if (previous || current) this.conflict();
    }
    if (!current) {
      // A canonical receipt with its entry missing is a user edit, not a pending add.
      if (this.record?.config.name === this.serverName) this.conflict();
      await this.install(deadline);
      current = await this.current(deadline);
    }
    if (!current || !this.matchesLaunch(current)
      || (this.record?.config.name === this.serverName && !isDeepStrictEqual(current, this.record.config))) this.conflict();
    this.save(current);
    unlinkSync(this.migrationPath);
  }
  async connect() {
    this.requireValidRecord();
    await this.migrateLegacy();
    // One deadline covers all CLI calls, including read-back; a busy home config
    // must not turn a 3-second command limit into a false connection failure.
    const deadline = Date.now() + 12_000;
    const entries = await this.entries(deadline);
    const current = entries.find(entry => entry.name === this.serverName);
    if (current) {
      if (this.record && !isDeepStrictEqual(current, this.record.config)) this.conflict();
      if (!this.matchesLaunch(current)) this.conflict();
      // Recover a crash after CLI installation but before the local receipt was saved.
      this.save(current);
      return;
    }
    if (entries.some(entry => entry.name === this.legacyServerName)) this.conflict();
    await this.install(deadline);
    const installed = await this.current(deadline);
    if (!installed || !this.matchesLaunch(installed)) throw new ManagementApiError('CODEX_CONFIG_FAILED', 503, 'Codex MCP 配置未确认写入。');
    this.save(installed);
  }
  async disconnect() {
    this.requireValidRecord();
    await this.migrateLegacy();
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
    if (this.recordInvalid) throw new ManagementApiError('CODEX_CONFIG_FAILED', 503, 'Yosh 的 Codex 配置记录不可读，未修改 Codex 配置。');
  }
}
