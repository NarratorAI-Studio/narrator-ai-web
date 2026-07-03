/**
 * Step 3 (任务参数) 模板配置 row builder — pure function, no React.
 *
 * The implementation requirement requirements: Step 3 should show the selected
 * template's parameters alongside the rest of the task config so users
 * can review everything in one place before final submission. The
 * original Step 3 summary only carried a single "模板" row with the
 * template name; this helper produces the full row group.
 *
 * Two input paths are supported:
 *   - **template-library**: `confirmedTemplate` is the chosen
 *     library template. Rows surface name / code / narrator type /
 *     language / platform / categories.
 *   - **custom-SRT**: `useCustomTemplate=true`. Rows surface mode label,
 *     SRT file name, writing type, and writing model.
 *
 * Missing / unknown fields degrade to `-` (per requirements) so
 * the layout never collapses; the calling component renders all rows
 * with a fixed grid template.
 */

export interface TemplateSummaryRow {
  label: string;
  value: string;
}

export interface TemplateSummaryTemplate {
  name?: string;
  code?: string;
  narrator_type?: { name?: string } | null;
  language?: string;
  platform?: { name?: string } | null;
  categories?: Array<{ name?: string }> | null;
}

export interface TemplateSummaryLearningSrt {
  name?: string;
}

export interface TemplateSummaryInput {
  useCustomTemplate: boolean;
  confirmedTemplate: TemplateSummaryTemplate | null;
  learningSrt?: TemplateSummaryLearningSrt | null;
  writingType?: 0 | 1 | 2;
  writingModel?: string;
}

const DASH = '-';

const WRITING_TYPE_LABELS: Record<number, string> = {
  0: '二创文案',
  1: '原创文案',
  2: '原创文案（带电影）',
};

// Keep in lockstep with the wizard's writing-model SelectItem labels and
// the budget/master-task detail pages — `pro` MUST render as 旗舰版 so
// the Step 3 review card matches what the user clicked on Step 2 and
// what later appears on the task-detail page (`narrator/tasks/page.tsx`,
// `hard-price-utils.ts` combo labels). See security hardening.
const WRITING_MODEL_LABELS: Record<string, string> = {
  flash: '极速版',
  pro: '旗舰版',
};

function fallback(v: string | undefined | null): string {
  return v && v.trim() ? v : DASH;
}

function joinCategoryNames(
  categories: Array<{ name?: string }> | null | undefined,
): string {
  if (!categories || categories.length === 0) return DASH;
  const names = categories.map(c => c?.name).filter((n): n is string => Boolean(n));
  return names.length ? names.join('、') : DASH;
}

/**
 * Whether Step 3 should render the template-configuration card at all.
 * Hides itself before either path's signal has appeared (e.g. user is
 * on Step 2 still picking) so the empty card never appears.
 */
export function shouldShowTemplateCard(input: TemplateSummaryInput): boolean {
  return Boolean(input.useCustomTemplate || input.confirmedTemplate);
}

export function buildTemplateSummaryRows(
  input: TemplateSummaryInput,
): TemplateSummaryRow[] {
  if (input.useCustomTemplate) {
    return [
      { label: '模板类型', value: '自定义 SRT' },
      { label: 'SRT 文件', value: fallback(input.learningSrt?.name) },
      {
        label: '文案类型',
        value:
          input.writingType !== undefined
            ? WRITING_TYPE_LABELS[input.writingType] ?? DASH
            : DASH,
      },
      {
        label: '文案模型',
        value: input.writingModel
          ? WRITING_MODEL_LABELS[input.writingModel] ?? input.writingModel
          : DASH,
      },
    ];
  }

  const tpl = input.confirmedTemplate;
  if (!tpl) return [];

  return [
    { label: '模板名称', value: fallback(tpl.name) },
    { label: '模板编号', value: fallback(tpl.code) },
    { label: '模板类型', value: fallback(tpl.narrator_type?.name) },
    { label: '语言', value: fallback(tpl.language) },
    { label: '平台', value: fallback(tpl.platform?.name) },
    { label: '分类', value: joinCategoryNames(tpl.categories) },
  ];
}
