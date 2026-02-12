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

type StageKey =
  | "hardware_install"
  | "hardware_stability"
  | "software_params"
  | "ai_training"
  | "run_validation"
  | "training";

const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: "hardware_install", label: "硬體安裝定位" },
  { key: "hardware_stability", label: "硬體穩定性調整" },
  { key: "software_params", label: "軟體參數設定" },
  { key: "ai_training", label: "AI參數訓練" },
  { key: "run_validation", label: "跑料驗證" },
  { key: "training", label: "教育訓練" },
];

function clampPercent(n: any) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function getStagePercent(progress: any, key: StageKey) {
  if (!progress || typeof progress !== "object") return 0;
  return clampPercent(progress?.[key]?.percent ?? 0);
}

function getOverall(progress: any) {
  if (!progress || typeof progress !== "object") return 0;
  const avg = STAGES.reduce((sum, s) => sum + getStagePercent(progress, s.key), 0) / STAGES.length;
  return clampPercent(avg);
}

export default function ProjectProgressList() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  // ✅ UI：儀錶板左上顯示名稱（取代 email）
  const [displayName, setDisplayName] = useState<string>("");

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
    setProjects((data ?? []) as ProjectRow[]);
  }

  async function refresh() {
    setMsg("");
    setLoading(true);
    try {
      await Promise.all([loadMeName(), loadProjects()]);
    } catch (e: any) {
      setProjects([]);
      setMsg("❌ " + (e?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const overall = useMemo(() => (p: ProjectRow) => getOverall(p.progress), []);
  const stagePercent = useMemo(() => (p: ProjectRow, k: StageKey) => getStagePercent(p.progress, k), []);

  if (loading) return <div style={{ color: "#6b7280" }}>載入中...</div>;
  if (msg) return <div style={{ color: "#b91c1c" }}>{msg}</div>;
  if (projects.length === 0) return <div style={{ color: "#6b7280" }}>（尚無專案）</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* ✅ 這段就是你截圖紅框左上：儀錶板下方顯示名稱（取代 email） */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 13, color: "#374151", fontWeight: 800 }}>{displayName}</div>
      </div>

      {/* ✅ 專案進度卡片（右側一排 6 個進度條） */}
      {projects.map((p) => {
        const ov = overall(p);

        return (
          <div key={p.id} style={card}>
            <div style={row}>
              {/* 左側：專案名稱/描述（跟你截圖左邊文字區塊一樣） */}
              <div style={leftCol}>
                <div style={{ fontWeight: 900, fontSize: 15 }}>{p.name}</div>
                {p.description && <div style={{ marginTop: 6, color: "#374151" }}>{p.description}</div>}
              </div>

              {/* 右側：一排 6 項進度條（你截圖大紅框那種排列） */}
              <div style={rightCol}>
                {STAGES.map((s) => {
                  const pct = stagePercent(p, s.key);
                  return (
                    <div key={s.key} style={miniCol} title={s.label}>
                      <div style={miniTitle}>{s.label}</div>
                      <div style={miniBarOuter}>
                        <div style={{ ...miniBarInner, width: `${pct}%` }} />
                      </div>
                      <div style={miniPct}>{pct}%</div>
                    </div>
                  );
                })}

                {/* ✅ 如果你也想要「整體進度」放在最前面一格（可選）
                    想要就把註解打開，並把 gridTemplateColumns 改成 repeat(7, ...)
                */}
                {/*
                <div style={miniCol} title="整體進度">
                  <div style={miniTitle}>整體進度</div>
                  <div style={miniBarOuter}>
                    <div style={{ ...miniBarInner, width: `${ov}%` }} />
                  </div>
                  <div style={miniPct}>{ov}%</div>
                </div>
                */}
              </div>
            </div>

            {/* ✅ 你若想保留「整體進度」在卡片下方一條大條（也可） */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>整體進度</div>
              <div style={barOuter}>
                <div style={{ ...barInner, width: `${ov}%` }} />
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#374151", textAlign: "right" }}>{ov}%</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** ---------- styles ---------- */

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 14,
  background: "#fff",
};

const row: React.CSSProperties = {
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
};

const leftCol: React.CSSProperties = {
  width: 220, // ✅ 左邊固定寬，對齊你截圖
  flex: "0 0 auto",
};

const rightCol: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "grid",
  gap: 12,
  // ✅ 一排 6 個「小進度條」欄位；螢幕窄會自動換行
  gridTemplateColumns: "repeat(6, minmax(120px, 1fr))",
  alignItems: "start",
};

const miniCol: React.CSSProperties = {
  display: "grid",
  gap: 6,
};

const miniTitle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  fontWeight: 800,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const miniBarOuter: React.CSSProperties = {
  width: "100%",
  height: 8,
  borderRadius: 999,
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  overflow: "hidden",
};

const miniBarInner: React.CSSProperties = {
  height: "100%",
  background: "#9ca3af", // ✅ 灰色，跟你截圖更像；想藍色可改回 #3b82f6
};

const miniPct: React.CSSProperties = {
  fontSize: 12,
  color: "#374151",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const barOuter: React.CSSProperties = {
  width: "100%",
  height: 10,
  borderRadius: 999,
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  overflow: "hidden",
};

const barInner: React.CSSProperties = {
  height: "100%",
  background: "#3b82f6",
};
