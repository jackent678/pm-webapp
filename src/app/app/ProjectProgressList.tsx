"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  progress: Record<string, any> | null;
  created_at: string;
};

type ScheduleItemRow = {
  id: string;
  project_id: string | null;
  work_date: string;
  title: string;
  details: string | null;
  item_type: "work" | "leave" | "move";
  priority?: number | null;
};

type StageKey =
  | "hardware_install"
  | "hardware_stability"
  | "software_params"
  | "ai_training"
  | "run_validation"
  | "training";

type UsageByProject = Record<
  string,
  {
    totalDays: number;
    stageDays: Record<StageKey, number>;
  }
>;

const STAGES: Array<{
  key: StageKey;
  label: string;
  color: string;
  keywords: string[];
}> = [
  {
    key: "hardware_install",
    label: "硬體安裝",
    color: "#3b82f6",
    keywords: ["硬體安裝定位", "硬體安裝", "hardware_install"],
  },
  {
    key: "hardware_stability",
    label: "穩定性調整",
    color: "#22c55e",
    keywords: ["硬體穩定性調整", "穩定性調整", "hardware_stability"],
  },
  {
    key: "software_params",
    label: "軟體參數",
    color: "#f97316",
    keywords: ["軟體參數設定", "軟體參數", "software_params"],
  },
  {
    key: "ai_training",
    label: "AI訓練",
    color: "#a855f7",
    keywords: ["AI參數訓練", "AI訓練", "ai_training"],
  },
  {
    key: "run_validation",
    label: "跑料驗證",
    color: "#0ea5e9",
    keywords: ["跑料驗證", "run_validation"],
  },
  {
    key: "training",
    label: "教育訓練",
    color: "#64748b",
    keywords: ["教育訓練", "training"],
  },
];

function clampPercent(n: any) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function clampNonNegInt(n: any, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (x < 0) return 0;
  return Math.round(x);
}

function normalizeMeta(p: any): { project_plan_days: number } {
  const m = p?._meta;
  return {
    project_plan_days: clampNonNegInt(m?.project_plan_days ?? 0, 0),
  };
}

function getStagePercent(progress: any, key: StageKey) {
  if (!progress || typeof progress !== "object") return 0;
  return clampPercent(progress?.[key]?.percent ?? 0);
}

function getStagePlanDays(progress: any, key: StageKey) {
  if (!progress || typeof progress !== "object") return 0;
  return clampNonNegInt(progress?.[key]?.plan_days ?? 0, 0);
}

function getOverall(progress: any) {
  if (!progress || typeof progress !== "object") return 0;
  const avg =
    STAGES.reduce((sum, s) => sum + getStagePercent(progress, s.key), 0) /
    STAGES.length;
  return clampPercent(avg);
}

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function isMissingRelationError(errMsg: string) {
  return /does not exist/i.test(errMsg) || /relation .* does not exist/i.test(errMsg);
}

function detectStageFromText(text: string): StageKey | null {
  const t = (text || "").toLowerCase();
  for (const s of STAGES) {
    for (const k of s.keywords) {
      if (t.includes(k.toLowerCase())) return s.key;
    }
  }
  return null;
}

function emptyStageDays(): Record<StageKey, number> {
  const obj = {} as Record<StageKey, number>;
  for (const s of STAGES) obj[s.key] = 0;
  return obj;
}

export default function ProjectProgressList() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [displayName, setDisplayName] = useState<string>("");
  const [usage, setUsage] = useState<UsageByProject>({});

  async function loadMeName() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw new Error(error.message);

    const user = data.user;
    if (!user) {
      setDisplayName("（未登入）");
      return;
    }

    const fallback = user.email ?? "（未命名）";

    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    if (pErr) throw new Error(pErr.message);

    setDisplayName((prof?.name ?? fallback).toString());
  }

  async function loadProjects() {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,description,progress,created_at")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as ProjectRow[];
  }

  async function loadUsageForProjects(projectIds: string[]) {
    if (projectIds.length === 0) return {};

    const { data, error } = await supabase
      .from("schedule_items")
      .select("id,project_id,work_date,title,details,item_type,priority")
      .in("project_id", projectIds)
      .eq("item_type", "work");

    if (error) {
      if (isMissingRelationError(error.message)) return {};
      throw new Error(error.message);
    }

    const rows = (data ?? []) as ScheduleItemRow[];

    const byProjectDateSet = new Map<string, Set<string>>();
    const byProjectStageDateSet = new Map<string, Map<StageKey, Set<string>>>();

    for (const r of rows) {
      if (!r.project_id) continue;
      const pid = r.project_id;
      const date = r.work_date;

      if (!byProjectDateSet.has(pid)) byProjectDateSet.set(pid, new Set<string>());
      byProjectDateSet.get(pid)!.add(date);

      let sk: StageKey | null = null;
      const pr = Number(r.priority ?? NaN);

      if (Number.isFinite(pr) && pr >= 1 && pr <= 6) {
        sk = STAGES[Math.round(pr) - 1]?.key ?? null;
      } else {
        const text = `${r.title ?? ""}\n${r.details ?? ""}`;
        sk = detectStageFromText(text);
      }

      if (sk) {
        if (!byProjectStageDateSet.has(pid)) {
          byProjectStageDateSet.set(pid, new Map());
        }
        const m = byProjectStageDateSet.get(pid)!;
        if (!m.has(sk)) m.set(sk, new Set<string>());
        m.get(sk)!.add(date);
      }
    }

    const result: UsageByProject = {};
    for (const pid of projectIds) {
      const totalDays = byProjectDateSet.get(pid)?.size ?? 0;
      const stageDays = emptyStageDays();

      const m = byProjectStageDateSet.get(pid);
      if (m) {
        for (const s of STAGES) {
          stageDays[s.key] = m.get(s.key)?.size ?? 0;
        }
      }

      result[pid] = { totalDays, stageDays };
    }

    return result;
  }

  async function refresh() {
    setMsg("");
    setLoading(true);
    try {
      const [_, list] = await Promise.all([loadMeName(), loadProjects()]);
      setProjects(list);

      const ids = list.map((p) => p.id);
      const usageMap = await loadUsageForProjects(ids);
      setUsage(usageMap);
    } catch (e: any) {
      setProjects([]);
      setUsage({});
      setMsg("❌ " + (e?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const overall = useMemo(() => (p: ProjectRow) => getOverall(p.progress), []);
  const stagePercent = useMemo(
    () => (p: ProjectRow, k: StageKey) => getStagePercent(p.progress, k),
    []
  );
  const stagePlanDays = useMemo(
    () => (p: ProjectRow, k: StageKey) => getStagePlanDays(p.progress, k),
    []
  );

  if (loading) return <div style={{ color: "#6b7280" }}>載入中...</div>;
  if (msg) return <div style={{ color: "#b91c1c" }}>{msg}</div>;
  if (projects.length === 0) {
    return <div style={{ color: "#6b7280" }}>（尚無專案）</div>;
  }

  return (
    <div style={pageWrap}>
      <div style={fullRow}>
        <div style={meName}>{displayName}</div>
      </div>

      <div style={cardsGrid}>
        {projects.map((p) => {
          const ov = overall(p);
          const usedDays = usage[p.id]?.totalDays ?? 0;
          const planDays = normalizeMeta(p.progress).project_plan_days;
          const isProjectOverdue = planDays > 0 && usedDays > planDays;

          return (
            <div key={p.id} style={card}>
              <div style={topRow}>
                <div style={leftCol}>
                  <div style={projTitle}>{p.name}</div>

                  {p.description && <div style={projDesc}>{p.description}</div>}

                  <div style={metaLine}>
                    <span style={metaDot} />
                    <span style={metaText}>{formatDate(p.created_at)}</span>
                  </div>
                </div>

                <div style={stageRail}>
                  <div style={stageGrid}>
                    {STAGES.map((s) => {
                      const pct = stagePercent(p, s.key);
                      const used = usage[p.id]?.stageDays?.[s.key] ?? 0;
                      const plan = stagePlanDays(p, s.key);
                      const stageOverdue = plan > 0 && used > plan;

                      return (
                        <div key={s.key} style={stageCol} title={s.label}>
                          <div style={stageLabelRow}>
                            <div style={stageLabel}>{s.label}</div>
                            <div style={stageDaysText(stageOverdue)}>
                              {used}/{plan > 0 ? plan : "—"}
                            </div>
                          </div>

                          <div style={miniBarOuter}>
                            <div
                              style={{
                                ...miniBarInner,
                                width: `${pct}%`,
                                background: s.color,
                              }}
                            />
                          </div>

                          <div style={stagePct}>{pct}%</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div style={overallWrap}>
                <div style={overallHead}>
                  <div style={overallLabel}>整體完成進度</div>
                  <div style={overallPct}>{ov}%</div>
                </div>

                <div style={barOuter}>
                  <div style={{ ...barInner, width: `${ov}%` }} />
                </div>

                <div style={overallFoot(isProjectOverdue)}>
                  已使用 {usedDays}/{planDays > 0 ? planDays : "—"} 天
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================== Styles ================== */

const pageWrap: React.CSSProperties = {
  display: "grid",
  gap: 12,
};

const fullRow: React.CSSProperties = {
  gridColumn: "1 / -1",
};

const cardsGrid: React.CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(760px, 1fr))",
  alignItems: "start",
};

const meName: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  color: "#111827",
};

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 12,
  background: "#fff",
};

const topRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
};

const leftCol: React.CSSProperties = {
  width: 200,
  flex: "0 0 auto",
  paddingRight: 10,
  borderRight: "1px solid #f1f5f9",
};

const projTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 18,
  color: "#111827",
};

const projDesc: React.CSSProperties = {
  marginTop: 4,
  color: "#6b7280",
  fontSize: 14,
  lineHeight: 1.35,
  whiteSpace: "pre-wrap",
};

const metaLine: React.CSSProperties = {
  marginTop: 6,
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#6b7280",
};

const metaDot: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 2,
  border: "1px solid #d1d5db",
  background: "#fff",
};

const metaText: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
};

const stageRail: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const stageGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
  gap: 12,
  alignItems: "start",
};

const stageCol: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const stageLabelRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
};

const stageLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 900,
  color: "#374151",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};

const stageDaysText = (over: boolean): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 900,
  color: over ? "#dc2626" : "#6b7280",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  flexShrink: 0,
});

const stagePct: React.CSSProperties = {
  fontSize: 13,
  color: "#374151",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const miniBarOuter: React.CSSProperties = {
  width: "100%",
  height: 8,
  borderRadius: 999,
  background: "#eef2f7",
  overflow: "hidden",
};

const miniBarInner: React.CSSProperties = {
  height: "100%",
  borderRadius: 999,
};

const overallWrap: React.CSSProperties = {
  marginTop: 10,
  paddingTop: 8,
  borderTop: "1px solid #f1f5f9",
};

const overallHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  marginBottom: 4,
};

const overallLabel: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 900,
  color: "#374151",
};

const overallPct: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  color: "#111827",
};

const barOuter: React.CSSProperties = {
  width: "100%",
  height: 10,
  borderRadius: 999,
  background: "#eef2f7",
  overflow: "hidden",
};

const barInner: React.CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "#3b82f6",
};

const overallFoot = (over: boolean): React.CSSProperties => ({
  marginTop: 6,
  fontSize: 13,
  color: over ? "#dc2626" : "#94a3b8",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  fontWeight: over ? 800 : 400,
});