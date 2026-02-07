import { readFileSync } from "fs";
import { join } from "path";

type PromptPair = {
  system: string;
  user: string;
};

/**
 * .md ファイルからプロンプトを読み込みキャッシュする
 * <!-- system --> と <!-- user --> セクションに分割
 */
const cache = new Map<string, PromptPair>();

function loadRaw(name: string): PromptPair {
  if (cache.has(name)) return cache.get(name)!;

  const filePath = join(process.cwd(), "src/lib/prompts", `${name}.md`);
  const content = readFileSync(filePath, "utf-8");

  const systemMatch = content.match(/<!--\s*system\s*-->\s*([\s\S]*?)(?=<!--\s*user\s*-->)/);
  const userMatch = content.match(/<!--\s*user\s*-->\s*([\s\S]*?)$/);

  const pair: PromptPair = {
    system: systemMatch?.[1]?.trim() || "",
    user: userMatch?.[1]?.trim() || "",
  };

  cache.set(name, pair);
  return pair;
}

/**
 * プロンプトを読み込み、変数を展開して返す
 *
 * @param name - ファイル名（拡張子なし）
 * @param vars - {{key}} を置換する変数マップ
 */
export function loadPrompt(
  name: string,
  vars: Record<string, string> = {}
): PromptPair {
  const raw = loadRaw(name);

  const substitute = (template: string): string => {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
  };

  return {
    system: substitute(raw.system),
    user: substitute(raw.user),
  };
}
