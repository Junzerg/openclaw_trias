import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { ConstitutionConfig, ConstitutionConfigSchema } from './models';

// Assuming the backend is run from `backend` folder, and the root is one level up.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../..'); 
const CONSTITUTION_PATH = join(PROJECT_ROOT, 'config', 'constitution.yaml');
const SOULS_DIR = join(PROJECT_ROOT, 'config', 'souls');

let _cachedConstitution: ConstitutionConfig | null = null;
const _soulCache = new Map<string, string>();

/**
 * Parses and returns the constitution configuration. Results are cached.
 */
export function loadConstitution(configDir?: string): ConstitutionConfig {
  if (_cachedConstitution && !configDir) {
    return _cachedConstitution;
  }

  const targetPath = configDir ? join(configDir, 'constitution.yaml') : CONSTITUTION_PATH;

  if (!existsSync(targetPath)) {
    throw new Error(`Constitution file not found at ${targetPath}`);
  }

  const fileContent = readFileSync(targetPath, 'utf-8');
  const parsedYaml = parse(fileContent);
  
  _cachedConstitution = ConstitutionConfigSchema.parse(parsedYaml);
  return _cachedConstitution;
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
  _cachedConstitution = null;
  _soulCache.clear();
}
