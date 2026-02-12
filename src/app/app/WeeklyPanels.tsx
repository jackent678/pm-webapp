"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type EngineerRow = { id: string; name: string };
type ProjectRow = { id: string; name: string };

type ScheduleItemRow = {
  id: string;
  engineer_id: string;
  work_date: string; // YYYY-MM-DD
  project_id: string | null;
  title: string;
  details: string | null;
  item_type: "work" | "leave" | "move";
  priority: 1 | 2 | 3;
  sort_order: number;
};

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeekMon(d: Date) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export default function WeeklyPanels({ variant = "default" }: { variant?: "default" | "dashboard" }) {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const [engineers, setEngineers] = useState<EngineerRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [thisWeek, setThisWeek] = useState<ScheduleItemRow[]>([]);
  const [nextWeek, setNextWeek] = useState<ScheduleItemRow[]>([]);

  const engineerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of engineers) m.set(e.id, e.name);
    return (id: string) => m.get(id) ?? "（未知工程師）";
  }, [engineers]);

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return (id: string | null) => (id ? m.get(id) ?? "（未知專案）" : "（未選專案）");
  }, [projects]);

  async function loadBase() {
    const [eRes, pRes] = await Promise.all([
      supabase.from("engineers").select("id,name").eq("is_active", true),
      supabase.from("projects").select("id,name"),
    ]);

    if (eRes.error) throw new Error(eRes.error.message);
    if (pRes.error) throw new Error(pRes.error.message);

    setEngineers((eRes.data ?? []) as EngineerRow[]);
    setProjects((pRes.data ?? []) as ProjectRow[]);
  }

  async function loadRange(start: Date, endExclusive: Date) {
    const { data, error } = await supabase
      .from("schedule_items")
      .select("id,engineer_id,work_date,project_id,title,details,item_type,priority,sort_order")
      .gte("work_date", toISODate(start))
      .lt("work_date", toISODate(endExclusive))
      .order("work_date", { ascending: true })
      .order("engineer_id", { ascending: true })
      .order("sort_order", { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as ScheduleItemRow[];
  }

  async function refresh() {
    setMsg("");
    setLoading(true);
    try {
      const ws = startOfWeekMon(new Date());
      const ns = addDays(ws, 7);

      await loadBase();

      const [a, b] = await Promise.all([loadRange(ws, addDays(ws, 7)), loadRange(ns, addDays(ns, 7))]);

      setThisWeek(a);
      setNextWeek(b);
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function typeLabel(t: ScheduleItemRow["item_type"]) {
    if (t === "leave") return "休假";
    if (t === "move") return "移動";
    return "工作";
  }

  function itemLine(it: ScheduleItemRow) {
    const left = `${it.work_date} · ${engineerName(it.engineer_id)}`;
    const mid = it.item_type === "work" ? projectName(it.project_id) : typeLabel(it.item_type);
    return `${left} · ${mid}`;
  }

  const EditLink = (
    <Link href="/app/plans" style={styles.linkBtn}>
      去行程規劃編輯 →
    </Link>
  );

  // ===== dashboard variant: 不再畫大卡片，直接畫兩個 section =====
  if (variant === "dashboard") {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        {msg && <div style={{ color: "#b91c1c" }}>{msg}</div>}

        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <div style={{ fontWeight: 700, color: "#374151" }}>這週行程（只讀）</div>
            {EditLink}
          </div>

          {loading ? (
            <div style={{ marginTop: 10, color: "#6b7280" }}>載入中...</div>
          ) : thisWeek.length === 0 ? (
            <div style={{ marginTop: 10, opacity: 0.7 }}>（本週尚無行程）</div>
          ) : (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {thisWeek.slice(0, 10).map((it) => (
                <div key={it.id} style={styles.row}>
                  <div style={{ fontWeight: 700, color: "#111827" }}>{it.title}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{itemLine(it)}</div>
                  {it.details && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#374151", whiteSpace: "pre-wrap" }}>
                      {it.details}
                    </div>
                  )}
                </div>
              ))}
              {thisWeek.length > 10 && (
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  已顯示 10 筆（共 {thisWeek.length} 筆），更多請到 /app/plans
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ ...styles.section, borderTop: "1px solid #f3f4f6", paddingTop: 14 }}>
          <div style={styles.sectionHeader}>
            <div style={{ fontWeight: 700, color: "#374151" }}>下週行程（只讀）</div>
            {EditLink}
          </div>

          {loading ? (
            <div style={{ marginTop: 10, color: "#6b7280" }}>載入中...</div>
          ) : nextWeek.length === 0 ? (
            <div style={{ marginTop: 10, opacity: 0.7 }}>（下週尚無行程）</div>
          ) : (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {nextWeek.slice(0, 10).map((it) => (
                <div key={it.id} style={styles.row}>
                  <div style={{ fontWeight: 700, color: "#111827" }}>{it.title}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{itemLine(it)}</div>
                  {it.details && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#374151", whiteSpace: "pre-wrap" }}>
                      {it.details}
                    </div>
                  )}
                </div>
              ))}
              {nextWeek.length > 10 && (
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  已顯示 10 筆（共 {nextWeek.length} 筆），更多請到 /app/plans
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== default variant: 原本兩張 card 版本（你其他頁需要可保留） =====
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ fontWeight: 900 }}>這週行程（只讀）</div>
          {EditLink}
        </div>

        {msg && <div style={{ color: "#d11", marginTop: 8 }}>{msg}</div>}
        {loading ? (
          <div style={{ marginTop: 10 }}>載入中...</div>
        ) : thisWeek.length === 0 ? (
          <div style={{ marginTop: 10, opacity: 0.7 }}>（本週尚無行程）</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {thisWeek.slice(0, 10).map((it) => (
              <div key={it.id} style={styles.row}>
                <div style={{ fontWeight: 900 }}>{it.title}</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>{itemLine(it)}</div>
                {it.details && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, whiteSpace: "pre-wrap" }}>{it.details}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ fontWeight: 900 }}>下週行程（只讀）</div>
          {EditLink}
        </div>

        {loading ? (
          <div style={{ marginTop: 10 }}>載入中...</div>
        ) : nextWeek.length === 0 ? (
          <div style={{ marginTop: 10, opacity: 0.7 }}>（下週尚無行程）</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {nextWeek.slice(0, 10).map((it) => (
              <div key={it.id} style={styles.row}>
                <div style={{ fontWeight: 900 }}>{it.title}</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>{itemLine(it)}</div>
                {it.details && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, whiteSpace: "pre-wrap" }}>{it.details}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // default cards
  card: {
    border: "1px solid #eee",
    borderRadius: 12,
    padding: 14,
    background: "#fff",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },

  // dashboard sections
  section: {
    display: "block",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },

  linkBtn: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    textDecoration: "none",
    color: "#374151",
    fontWeight: 600,
    fontSize: 12,
    background: "#fff",
  },

  row: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 10,
    background: "#fff",
  },
};
