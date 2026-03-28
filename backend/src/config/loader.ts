import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { ConstitutionConfig, ConstitutionConfigSchema, type ModelRoutingConfig } from './models';

// Assuming the backend is run from `backend` folder, and the root is one level up.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../..'); 
const CONSTITUTION_PATH = join(PROJECT_ROOT, 'config', 'constitution.yaml');
export const SOULS_DIR = join(PROJECT_ROOT, 'config', 'souls');

const _cachedConstitutions = new Map<string, ConstitutionConfig>();
const _soulCache = new Map<string, string>();

/**
 * Parses and returns the constitution configuration. Results are cached.
 */
export function loadConstitution(configDir?: string): ConstitutionConfig {
  const targetPath = configDir ? join(configDir, 'constitution.yaml') : CONSTITUTION_PATH;
  
  if (_cachedConstitutions.has(targetPath)) {
    return _cachedConstitutions.get(targetPath)!;
  }

  if (!existsSync(targetPath)) {
    throw new Error(`Constitution file not found at ${targetPath}`);
  }

  const fileContent = readFileSync(targetPath, 'utf-8');
  const parsedYaml = parse(fileContent);
  
  const config = ConstitutionConfigSchema.parse(parsedYaml);
  _cachedConstitutions.set(targetPath, config);
  return config;
}

/**
 * Extracts pure text skipping the frontmatter if any, 
 * or purely retrieves the content of the markdown file.
 * We emulate extract_system_prompt from python.
 */
export function extractSystemPrompt(content: string): string {
  // Can be refined if we use precise frontmatter parsing block "---"
  // For now, we return it as is since pure system prompt markdown is used without strict yaml frontmatters in most cases.
  return content.trim();
}

/**
 * Reads a soul markdown file by role name and caches it.
 */
export function loadSoul(role: string): string {
  if (_soulCache.has(role)) {
    return _soulCache.get(role)!;
  }

  const soulPath = join(SOULS_DIR, `SOUL_${role.toUpperCase()}.md`);
  const soulPathAlternative = join(SOULS_DIR, `${role}.md`);
  let content = '';
  
  if (existsSync(soulPath)) {
    content = readFileSync(soulPath, 'utf-8');
  } else if (existsSync(soulPathAlternative)) {
    content = readFileSync(soulPathAlternative, 'utf-8');
  } else {
    // We allow an agent to not have a physical soul file in tests, 
    // but in real run they might fail or just give empty.
    // Given the Python implementation, it allows `soul_path` to be None.
    throw new Error(`Soul file not found for role: ${role}`);
  }

  const prompt = extractSystemPrompt(content);
  _soulCache.set(role, prompt);
  return prompt;
}

/**
 * Force clear caches (useful for tests)
 */
export function clearConfigCache() {
  _cachedConstitutions.clear();
  _soulCache.clear();
}

/**
 * Invalidate a specific soul cache entry so the next loadSoul() call
 * reads fresh content from disk. Used by the hot-edit API.
 */
export function invalidateSoul(role: string): void {
  _soulCache.delete(role);
}

/**
 * List all soul file basenames (without extension) from the souls directory.
 * Returns names like ['speaker', 'radical_mp', 'conservative_mp', ...].
 */
export function listSoulNames(): string[] {
  if (!existsSync(SOULS_DIR)) return [];
  return readdirSync(SOULS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

/**
 * Write new content to a soul markdown file on disk.
 * Throws if the souls directory doesn't exist.
 */
export function writeSoulFile(name: string, content: string): void {
  const filePath = join(SOULS_DIR, `${name}.md`);
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Resolve the effective model identifier for a given agent role.
 *
 * Priority: overrides[role] > routing.default > undefined (adapter uses its own defaultModel)
 */
export function resolveModel(role: string, routing?: ModelRoutingConfig): string | undefined {
  if (!routing) return undefined;
  return routing.overrides?.[role] ?? routing.default;
}
