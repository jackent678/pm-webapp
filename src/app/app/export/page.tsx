"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "../Sidebar";

type ProjectRow = {
  id: string;
  name: string;
};

type EngineerRow = {
  id: string;
  name: string;
};

type ScheduleItemRow = {
  id: string;
  engineer_id: string;
  work_date: string;
  project_id: string | null;
  title: string;
  details: string | null;
  item_type: "work" | "leave" | "move";
  priority: number | null;
  sort_order: number;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(baseISO: string, days: number) {
  const d = new Date(baseISO);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function typeLabel(t: ScheduleItemRow["item_type"]) {
  if (t === "leave") return "休假";
  if (t === "move") return "移動";
  return "工作";
}

export default function ExportPage() {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState("");

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [engineers, setEngineers] = useState<EngineerRow[]>([]);
  const [items, setItems] = useState<ScheduleItemRow[]>([]);

  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(addDaysISO(todayISO(), 7));
  const [projectId, setProjectId] = useState("");
  const [onlyWork, setOnlyWork] = useState(true);

  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  const engineerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of engineers) m.set(e.id, e.name);
    return (id: string) => m.get(id) ?? "（未知工程師）";
  }, [engineers]);

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return (id: string | null) => (id ? m.get(id) ?? "（未知專案）" : "（未指定專案）");
  }, [projects]);

  const selectedCount = useMemo(
    () => Object.values(selectedIds).filter(Boolean).length,
    [selectedIds]
  );

  async function loadBase() {
    const [pRes, eRes] = await Promise.all([
      supabase.from("projects").select("id,name").order("name", { ascending: true }),
      supabase.from("engineers").select("id,name").eq("is_active", true).order("name", { ascending: true }),
    ]);

    if (pRes.error) throw new Error(pRes.error.message);
    if (eRes.error) throw new Error(eRes.error.message);

    setProjects((pRes.data ?? []) as ProjectRow[]);
    setEngineers((eRes.data ?? []) as EngineerRow[]);
  }

  async function searchItems() {
    setMsg("");
    setLoading(true);
    try {
      let query = supabase
        .from("schedule_items")
        .select("id,engineer_id,work_date,project_id,title,details,item_type,priority,sort_order")
        .gte("work_date", dateFrom)
        .lte("work_date", dateTo)
        .order("work_date", { ascending: true })
        .order("sort_order", { ascending: true });

      if (projectId) query = query.eq("project_id", projectId);
      if (onlyWork) query = query.eq("item_type", "work");

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as ScheduleItemRow[];
      setItems(rows);

      const nextSelected: Record<string, boolean> = {};
      for (const row of rows) nextSelected[row.id] = true;
      setSelectedIds(nextSelected);

      if (rows.length === 0) setMsg("查無符合條件的行程資料。");
    } catch (e: any) {
      setItems([]);
      setSelectedIds({});
      setMsg("❌ " + (e?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }

  async function init() {
    setLoading(true);
    setMsg("");
    try {
      await loadBase();
      await searchItems();
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "unknown"));
      setLoading(false);
    }
  }

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleOne(id: string) {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function selectAll() {
    const next: Record<string, boolean> = {};
    for (const row of items) next[row.id] = true;
    setSelectedIds(next);
  }

  function clearAll() {
    const next: Record<string, boolean> = {};
    for (const row of items) next[row.id] = false;
    setSelectedIds(next);
  }

  async function exportPpt() {
    const itemIds = items.filter((x) => selectedIds[x.id]).map((x) => x.id);

    if (itemIds.length === 0) {
      alert("請先勾選要匯出的資料");
      return;
    }

    setExporting(true);
    try {
      const res = await fetch("/api/export-ppt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "匯出失敗");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-export-${dateFrom}-to-${dateTo}.pptx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message ?? "匯出失敗");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={styles.shell}>
      <div style={styles.sidebarWrap}>
        <Sidebar />
      </div>

      <div style={styles.main}>
        <div style={styles.topbar}>
          <div>
            <h1 style={styles.h1}>匯出 PPT</h1>
            <div style={styles.sub}>依日期區間與專案篩選行程資料，勾選後匯出成 PowerPoint。</div>
          </div>

          <button
            onClick={exportPpt}
            disabled={exporting || loading || selectedCount === 0}
            style={styles.primaryBtn}
          >
            {exporting ? "匯出中..." : `匯出 PPT（${selectedCount} 筆）`}
          </button>
        </div>

        <div style={styles.filterCard}>
          <div style={styles.filterGrid}>
            <div>
              <div style={styles.label}>開始日期</div>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <div style={styles.label}>結束日期</div>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <div style={styles.label}>專案</div>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                style={styles.input}
              >
                <option value="">全部專案</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "end" }}>
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={onlyWork}
                  onChange={(e) => setOnlyWork(e.target.checked)}
                />
                只顯示工作類型
              </label>
            </div>
          </div>

          <div style={styles.filterActions}>
            <button onClick={searchItems} style={styles.btn}>
              查詢資料
            </button>
            <button onClick={selectAll} style={styles.btn}>
              全選
            </button>
            <button onClick={clearAll} style={styles.btn}>
              全不選
            </button>
          </div>
        </div>

        {msg && <div style={styles.msg}>{msg}</div>}

        <div style={styles.listCard}>
          <div style={styles.listHead}>
            <div style={styles.listTitle}>資料列表</div>
            <div style={styles.listSub}>共 {items.length} 筆，已勾選 {selectedCount} 筆</div>
          </div>

          {loading ? (
            <div style={styles.empty}>載入中...</div>
          ) : items.length === 0 ? (
            <div style={styles.empty}>（目前沒有資料）</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {items.map((it) => (
                <label key={it.id} style={styles.row}>
                  <div style={styles.rowCheck}>
                    <input
                      type="checkbox"
                      checked={!!selectedIds[it.id]}
                      onChange={() => toggleOne(it.id)}
                    />
                  </div>

                  <div style={styles.rowMain}>
                    <div style={styles.rowTitle}>{it.title}</div>
                    <div style={styles.rowMeta}>
                      {it.work_date} · {engineerName(it.engineer_id)} ·{" "}
                      {it.item_type === "work" ? projectName(it.project_id) : typeLabel(it.item_type)}
                    </div>
                    <div style={styles.rowDetails}>
                      {it.details?.trim() ? it.details : "（無工作內容說明）"}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    minHeight: "100vh",
    backgroundColor: "#f3f4f6",
  },
  sidebarWrap: {
    width: 260,
    flexShrink: 0,
    backgroundColor: "#fff",
    borderRight: "1px solid #e5e7eb",
  },
  main: {
    flex: 1,
    minWidth: 0,
    padding: 24,
  },
  topbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 800,
    color: "#111827",
  },
  sub: {
    marginTop: 6,
    fontSize: 13,
    color: "#6b7280",
  },
  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  filterCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    background: "#fff",
    padding: 14,
  },
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: 700,
    color: "#6b7280",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    fontSize: 14,
    outline: "none",
    background: "#fff",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    color: "#374151",
  },
  filterActions: {
    marginTop: 12,
    display: "flex",
    gap: 8,
  },
  btn: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#374151",
    fontWeight: 700,
    cursor: "pointer",
  },
  msg: {
    marginTop: 16,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #fee2e2",
    background: "#fef2f2",
    color: "#b91c1c",
    fontSize: 14,
  },
  listCard: {
    marginTop: 16,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    background: "#fff",
    padding: 14,
  },
  listHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: "#111827",
  },
  listSub: {
    fontSize: 12,
    color: "#6b7280",
  },
  empty: {
    padding: "20px 10px",
    color: "#6b7280",
    textAlign: "center",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "28px 1fr",
    gap: 10,
    alignItems: "start",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 12,
    background: "#fff",
    cursor: "pointer",
  },
  rowCheck: {
    paddingTop: 2,
  },
  rowMain: {
    minWidth: 0,
  },
  rowTitle: {
    fontWeight: 800,
    fontSize: 15,
    color: "#111827",
  },
  rowMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "#6b7280",
  },
  rowDetails: {
    marginTop: 8,
    fontSize: 13,
    color: "#374151",
    whiteSpace: "pre-wrap",
    lineHeight: 1.5,
  },
};