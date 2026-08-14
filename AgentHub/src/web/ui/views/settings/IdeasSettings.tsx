import { Lightbulb, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { apiFetch } from "../../api";
import { Button, LoadingState, Toggle } from "../../components";
import { useToast } from "../../components/Toast";

/**
 * Ideas/funnel config-as-data Settings section. GETs the current EFFECTIVE
 * values from /api/config/ideas (DB > env > default merged config) and PUTs a
 * PARTIAL per section. Each panel saves independently to its own
 * config_overrides key so two panels never clobber each other.
 *
 * These values are read per pipeline run via loadConfigWithOverrides, so they
 * take effect WITHOUT a restart — no restart notice is shown.
 */

interface OutcomeMemory {
  readonly writeBack: boolean;
  readonly readAtSynthesis: boolean;
  readonly reinforceCap: number;
  readonly avoidCap: number;
  readonly searchLimit: number;
}

interface IncumbentExclusion {
  readonly enabled: boolean;
  readonly topN: number;
}

type BucketBy = "archetype" | "category";

interface DiversityGuard {
  readonly enabled: boolean;
  readonly maxBucketShare: number;
  readonly bucketBy: BucketBy;
}

type Capital = "none" | "bootstrap" | "seed" | "funded";
type Appetite = "none" | "low" | "high";

interface BuilderProfile {
  readonly capital: Capital;
  readonly teamSize: number;
  readonly expertiseDomains: readonly string[];
  readonly regulatoryAppetite: Appetite;
  readonly opsAppetite: Appetite;
}

interface Competability {
  readonly enabled: boolean;
  readonly enforceGate: boolean;
  readonly rejectThreshold: number;
  readonly softPenaltyThreshold: number;
  readonly topNIncumbents: number;
  readonly builderProfile: BuilderProfile;
}

interface EffectiveConfig {
  readonly outcomeMemory: OutcomeMemory;
  readonly incumbentExclusion: IncumbentExclusion;
  readonly diversityGuard: DiversityGuard;
  readonly competability: Competability;
}

interface IdeasConfigResponse {
  readonly effective: EffectiveConfig;
  readonly overrides: Record<string, unknown>;
}

const OPTION_LABELS: Record<string, string> = {
  archetype: "原型",
  category: "类别",
  none: "无",
  bootstrap: "自筹",
  seed: "种子轮",
  funded: "已有融资",
  low: "低",
  high: "高",
};

/* ── Shared form primitives ── */

function NumberField({
  label,
  description,
  value,
  min,
  max,
  step,
  onChange,
}: {
  readonly label: string;
  readonly description?: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (v: number) => void;
}) {
  const baseId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div id={`${baseId}-l`} className="text-xs font-medium text-foreground">
          {label}
        </div>
        {description && (
          <div id={`${baseId}-d`} className="text-xs text-muted mt-0.5">
            {description}
          </div>
        )}
      </div>
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        aria-labelledby={`${baseId}-l`}
        aria-describedby={description ? `${baseId}-d` : undefined}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="w-24 shrink-0 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:border-accent"
      />
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {description && <div className="text-xs text-muted mt-0.5">{description}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function SelectField<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly description?: string;
  readonly value: T;
  readonly options: readonly T[];
  readonly onChange: (v: T) => void;
}) {
  const baseId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div id={`${baseId}-l`} className="text-xs font-medium text-foreground">
          {label}
        </div>
        {description && (
          <div id={`${baseId}-d`} className="text-xs text-muted mt-0.5">
            {description}
          </div>
        )}
      </div>
      <select
        value={value}
        aria-labelledby={`${baseId}-l`}
        aria-describedby={description ? `${baseId}-d` : undefined}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-32 shrink-0 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {OPTION_LABELS[opt] ?? opt}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── String list editor for builderProfile.expertiseDomains ── */
function StringListField({
  label,
  description,
  values,
  onChange,
}: {
  readonly label: string;
  readonly description?: string;
  readonly values: readonly string[];
  readonly onChange: (v: readonly string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (trimmed === "" || values.includes(trimmed) || values.length >= 50) return;
    onChange([...values, trimmed.slice(0, 80)]);
    setDraft("");
  }

  function remove(domain: string) {
    onChange(values.filter((v) => v !== domain));
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-xs font-medium text-foreground">{label}</div>
        {description && <div className="text-xs text-muted mt-0.5">{description}</div>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 && (
          <span className="text-xs text-faint">暂无领域，留空时不做领域匹配。</span>
        )}
        {values.map((domain) => (
          <span
            key={domain}
            className="inline-flex items-center gap-1 text-xs bg-bg-3 text-foreground px-2 py-0.5 rounded-full"
          >
            {domain}
            <button
              type="button"
              aria-label={`移除 ${domain}`}
              onClick={() => remove(domain)}
              className="text-muted hover:text-foreground bg-transparent border-none cursor-pointer p-0 flex items-center"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          maxLength={80}
          placeholder="添加领域，例如 fintech"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
        />
        <Button variant="ghost" size="sm" onClick={add} disabled={draft.trim() === ""}>
          添加
        </Button>
      </div>
    </div>
  );
}

/* ── A panel that owns one override section's draft + save ── */
function ConfigPanel<T>({
  title,
  description,
  section,
  initial,
  toBody,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly section: string;
  readonly initial: T;
  readonly toBody: (draft: T) => unknown;
  readonly children: (draft: T, set: (next: T) => void) => React.ReactNode;
}) {
  const { success, error: toastError } = useToast();
  const [draft, setDraft] = useState<T>(initial);
  const [saving, setSaving] = useState(false);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(initial);

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch(`/api/config/ideas/${section}`, {
        method: "PUT",
        body: JSON.stringify(toBody(draft)),
      });
      success(`${title} 已保存。`);
    } catch {
      toastError(`${title} 保存失败。`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-bg-1 border border-border rounded-xl p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-strong m-0">{title}</h3>
        <p className="text-xs text-muted m-0 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className="flex flex-col gap-3">{children(draft, setDraft)}</div>
      <div className="flex justify-end gap-2 pt-4">
        {isDirty && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(initial)} disabled={saving}>
            重置
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving || !isDirty}
          loading={saving}
        >
          保存
        </Button>
      </div>
    </div>
  );
}

/* ── Main section ── */
export default function IdeasSettings() {
  const { error: toastError } = useToast();
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ data: IdeasConfigResponse }>("/api/config/ideas");
        if (!cancelled) setConfig(res.data.effective);
      } catch {
        if (!cancelled) toastError("创意漏斗配置加载失败。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState message="正在加载创意配置..." />;
  if (!config) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3.5">
        <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-accent-subtle text-accent">
          <Lightbulb className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-strong m-0">创意与漏斗</h2>
          <p className="text-xs text-muted m-0 mt-0.5">
            管理结果记忆、存量竞品排除、多样性保护和小团队可行性门槛。修改会在下一次管线运行时生效，无需重启。
          </p>
        </div>
      </div>

      {/* Outcome memory */}
      <ConfigPanel<OutcomeMemory>
        title="结果记忆"
        description="把创意判定写回 mem0，并在合成阶段注入已学习的强化/规避建议。"
        section="outcomeMemory"
        initial={config.outcomeMemory}
        toBody={(d) => d}
      >
        {(draft, set) => (
          <>
            <ToggleField
              label="写回判定"
              description="把创意判定持久化到 mem0。"
              checked={draft.writeBack}
              onChange={(v) => set({ ...draft, writeBack: v })}
            />
            <ToggleField
              label="合成时读取"
              description="把已学习的建议注入合成提示词。"
              checked={draft.readAtSynthesis}
              onChange={(v) => set({ ...draft, readAtSynthesis: v })}
            />
            <NumberField
              label="强化建议上限"
              description="最多注入的强化建议数量（1-20）。"
              value={draft.reinforceCap}
              min={1}
              max={20}
              onChange={(v) => set({ ...draft, reinforceCap: v })}
            />
            <NumberField
              label="规避建议上限"
              description="最多注入的规避建议数量（1-20）。"
              value={draft.avoidCap}
              min={1}
              max={20}
              onChange={(v) => set({ ...draft, avoidCap: v })}
            />
            <NumberField
              label="搜索上限"
              description="每个判定桶最多读取的 mem0 结果数（1-50）。"
              value={draft.searchLimit}
              min={1}
              max={50}
              onChange={(v) => set({ ...draft, searchLimit: v })}
            />
          </>
        )}
      </ConfigPanel>

      {/* Incumbent exclusion */}
      <ConfigPanel<IncumbentExclusion>
        title="存量竞品排除"
        description="降低或剔除命中头部竞品的采集信号。"
        section="incumbentExclusion"
        initial={config.incumbentExclusion}
        toBody={(d) => d}
      >
        {(draft, set) => (
          <>
            <ToggleField
              label="启用"
              checked={draft.enabled}
              onChange={(v) => set({ ...draft, enabled: v })}
            />
            <NumberField
              label="头部竞品数量"
              description="将多少个榜单头部应用视为存量竞品（1-1000）。"
              value={draft.topN}
              min={1}
              max={1000}
              onChange={(v) => set({ ...draft, topN: v })}
            />
          </>
        )}
      </ConfigPanel>

      {/* Diversity guard */}
      <ConfigPanel<DiversityGuard>
        title="多样性保护"
        description="限制单一原型或类别在保留结果中的占比，避免漏斗收敛到单一方向。"
        section="diversityGuard"
        initial={config.diversityGuard}
        toBody={(d) => d}
      >
        {(draft, set) => (
          <>
            <ToggleField
              label="启用"
              checked={draft.enabled}
              onChange={(v) => set({ ...draft, enabled: v })}
            />
            <NumberField
              label="单桶占比上限"
              description="任一桶可占据的最高比例（0-1），例如 0.5 表示不超过一半。"
              value={draft.maxBucketShare}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set({ ...draft, maxBucketShare: v })}
            />
            <SelectField<BucketBy>
              label="分桶字段"
              description="用候选项的哪个字段来划分桶。"
              value={draft.bucketBy}
              options={["archetype", "category"]}
              onChange={(v) => set({ ...draft, bucketBy: v })}
            />
          </>
        )}
      </ConfigPanel>

      {/* Competability gate */}
      <ConfigPanel<Competability>
        title="小团队可行性门槛"
        description="惩罚对小团队不友好的高壁垒创意；影子模式只记录可能拒绝的结果，不直接丢弃。"
        section="competability"
        initial={config.competability}
        toBody={(d) => d}
      >
        {(draft, set) => (
          <>
            <ToggleField
              label="启用"
              description="为每个创意计算并保存可行性评分卡。"
              checked={draft.enabled}
              onChange={(v) => set({ ...draft, enabled: v })}
            />
            <ToggleField
              label="强制执行门槛"
              description="实际丢弃低于拒绝阈值的创意；关闭则为影子模式。"
              checked={draft.enforceGate}
              onChange={(v) => set({ ...draft, enforceGate: v })}
            />
            <NumberField
              label="拒绝阈值"
              description="总分低于该值（0-5）时，在强制模式下直接拒绝。"
              value={draft.rejectThreshold}
              min={0}
              max={5}
              step={0.1}
              onChange={(v) => set({ ...draft, rejectThreshold: v })}
            />
            <NumberField
              label="软惩罚阈值"
              description="软惩罚区间上限（0-5）：记录并降权，但不直接拒绝。"
              value={draft.softPenaltyThreshold}
              min={0}
              max={5}
              step={0.1}
              onChange={(v) => set({ ...draft, softPenaltyThreshold: v })}
            />
            <NumberField
              label="预过滤竞品数量"
              description="低成本启发式检查时对照的竞品数量（1-1000）。"
              value={draft.topNIncumbents}
              min={1}
              max={1000}
              onChange={(v) => set({ ...draft, topNIncumbents: v })}
            />

            <div className="border-t border-border pt-3 mt-1 flex flex-col gap-3">
              <div className="text-xs font-medium text-muted uppercase tracking-wide">
                构建者画像
              </div>
              <SelectField<Capital>
                label="资金能力"
                description="构建者可持续投入的资金水平。"
                value={draft.builderProfile.capital}
                options={["none", "bootstrap", "seed", "funded"]}
                onChange={(v) =>
                  set({ ...draft, builderProfile: { ...draft.builderProfile, capital: v } })
                }
              />
              <NumberField
                label="团队规模"
                description="团队人数；超过 1 人会降低运营壁垒惩罚（1-1000）。"
                value={draft.builderProfile.teamSize}
                min={1}
                max={1000}
                onChange={(v) =>
                  set({ ...draft, builderProfile: { ...draft.builderProfile, teamSize: v } })
                }
              />
              <SelectField<Appetite>
                label="监管承受度"
                description="进入受监管市场的意愿和能力。"
                value={draft.builderProfile.regulatoryAppetite}
                options={["none", "low", "high"]}
                onChange={(v) =>
                  set({
                    ...draft,
                    builderProfile: { ...draft.builderProfile, regulatoryAppetite: v },
                  })
                }
              />
              <SelectField<Appetite>
                label="运营承受度"
                description="承担线下或重运营工作的意愿。"
                value={draft.builderProfile.opsAppetite}
                options={["none", "low", "high"]}
                onChange={(v) =>
                  set({ ...draft, builderProfile: { ...draft.builderProfile, opsAppetite: v } })
                }
              />
              <StringListField
                label="专业领域"
                description="构建者擅长的领域；文本命中后会降低对应创意的壁垒惩罚。最多 50 个，每个 80 字符。"
                values={draft.builderProfile.expertiseDomains}
                onChange={(v) =>
                  set({
                    ...draft,
                    builderProfile: { ...draft.builderProfile, expertiseDomains: v },
                  })
                }
              />
            </div>
          </>
        )}
      </ConfigPanel>
    </div>
  );
}
